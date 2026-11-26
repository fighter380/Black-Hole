use serde::Serialize;
use serialport::{SerialPort, SerialPortType};
use std::io::ErrorKind;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::ipc::Channel;

#[derive(Default)]
pub struct SerialMonitor(Arc<Mutex<Option<Session>>>);

struct Session {
    write: SyncSender<Vec<u8>>,
    stopping: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Serialize)]
pub struct PortInfo {
    name: String,
    description: Option<String>,
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|error| error.to_string())?;
    Ok(ports
        .into_iter()
        .map(|port| PortInfo {
            name: port.port_name,
            description: match port.port_type {
                SerialPortType::UsbPort(usb) => usb.product.or(usb.manufacturer),
                SerialPortType::BluetoothPort => Some("Bluetooth".into()),
                _ => None,
            },
        })
        .collect())
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SerialEvent {
    Data { bytes: Vec<u8> },
    Closed { error: Option<String> },
}

fn monitor_port(
    port: &mut dyn SerialPort,
    input: Receiver<Vec<u8>>,
    stopping: &AtomicBool,
    output: &Channel<SerialEvent>,
) -> Result<(), String> {
    let mut buffer = [0; 4096];
    while !stopping.load(Ordering::Relaxed) {
        if let Ok(bytes) = input.try_recv() {
            port.write_all(&bytes)
                .map_err(|e| format!("Écriture sur le port — {e}"))?;
        }
        match port.read(&mut buffer) {
            Ok(0) => return Err("Port série fermé.".into()),
            Ok(count) => {
                if output
                    .send(SerialEvent::Data {
                        bytes: buffer[..count].to_vec(),
                    })
                    .is_err()
                {
                    return Ok(());
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    ErrorKind::TimedOut | ErrorKind::Interrupted | ErrorKind::WouldBlock
                ) => {}
            Err(error) => return Err(format!("Lecture du port — {error}")),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn serial_connect(
    port: String,
    baud: u32,
    output: Channel<SerialEvent>,
    state: tauri::State<'_, SerialMonitor>,
) -> Result<(), String> {
    if !(300..=2_000_000).contains(&baud) {
        return Err("Débit série invalide.".into());
    }
    let mut running = state.0.lock().map_err(|error| error.to_string())?;
    if running
        .as_ref()
        .and_then(|session| session.worker.as_ref())
        .is_some_and(|worker| !worker.is_finished())
    {
        return Err("Ferme le moniteur série avant d’ouvrir un autre port.".into());
    }
    let mut device = serialport::new(&port, baud)
        .timeout(Duration::from_millis(65))
        .open()
        .map_err(|error| format!("Impossible d’ouvrir {port} — {error}"))?;

    let (write, input) = mpsc::sync_channel(16);
    let stopping = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stopping);
    let worker = thread::spawn(move || {
        let error = monitor_port(&mut *device, input, &flag, &output).err();
        drop(device);
        let _ = output.send(SerialEvent::Closed { error });
    });
    *running = Some(Session {
        write,
        stopping,
        worker: Some(worker),
    });
    Ok(())
}

#[tauri::command]
pub fn serial_send(text: String, state: tauri::State<'_, SerialMonitor>) -> Result<(), String> {
    if text.len() > 4096 {
        return Err("Le message série dépasse 4 096 octets.".into());
    }
    let running = state.0.lock().map_err(|error| error.to_string())?;
    let session = running.as_ref().ok_or("Moniteur série déconnecté.")?;
    session
        .write
        .try_send(text.into_bytes())
        .map_err(|error| match error {
            TrySendError::Full(_) => "Le port série est occupé. Réessaie dans un instant.".into(),
            TrySendError::Disconnected(_) => "Moniteur série déconnecté.".into(),
        })
}

#[tauri::command]
pub async fn serial_disconnect(state: tauri::State<'_, SerialMonitor>) -> Result<(), String> {
    let process = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        // Keep the state locked until the thread has closed the OS handle.
        let mut running = process.lock().map_err(|error| error.to_string())?;
        drop(running.take());
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
