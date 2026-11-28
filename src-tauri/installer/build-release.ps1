[CmdletBinding()]
param(
    [string]$BaseCommit,
    [string]$PreviousManifest,
    [version]$PublishedVersion,
    [switch]$AutoVersion,
    [switch]$UseNpmCli,
    [string]$KeyPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.tauri/black-hole.key')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$configPath = Join-Path $project 'src-tauri/tauri.conf.json'
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$utf8 = [Text.UTF8Encoding]::new($false)
$version = [version]$config.version

function Get-ReleaseNotes([string]$Commit, [string]$Base, [string]$PreviousPath, [version]$Version) {
    $previous = if ($PreviousPath) { Get-Content -Raw -Encoding UTF8 -LiteralPath $PreviousPath | ConvertFrom-Json }
    $range = $Commit
    if ($Base -and $Base -notmatch '^0{40}$') {
        if ($Base -notmatch '^[0-9a-f]{40}$') { throw 'SHA du commit precedent invalide.' }
        git merge-base --is-ancestor $Base $Commit
        if ($LASTEXITCODE -ne 0) { throw "Le commit publie ne fait pas partie de l'historique du build." }
        $range = "$Base..$Commit"
    }
    $changes = git -c i18n.logOutputEncoding=UTF-8 log '--format=- %s (%h)' $range
    if ($LASTEXITCODE -ne 0) { throw "Impossible de lire l'historique Git." }

    $notes = @("v$Version")
    if ($changes) { $notes += $changes }
    else { $notes += 'Aucun nouveau commit.' }

    if ($range -ne $Commit) {
        if ($previous.notes_format -eq 1 -and $previous.commit -eq $Base -and $previous.notes) {
            $notes += '', $previous.notes
        } else {
            $archive = git -c i18n.logOutputEncoding=UTF-8 log '--format=- %s (%h)' $Base
            if ($LASTEXITCODE -ne 0) { throw "Impossible de lire les anciens commits." }
            $notes += '', 'Commits antérieurs · versions de publication non vérifiées'
            $notes += $archive
        }
    }
    $notes -join "`n"
}

if ($AutoVersion) {
    if ($PublishedVersion -gt $version) { $version = $PublishedVersion }
    if ($version.Build -ge 65535) { throw 'Augmente la version mineure dans tauri.conf.json.' }
    $version = [version]::new($version.Major, $version.Minor, ($version.Build + 1))
    $config.version = $version.ToString()
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8)
    $cargoPath = Join-Path $project 'src-tauri/Cargo.toml'
    $cargo = (Get-Content -Raw -LiteralPath $cargoPath) -replace '(?m)^version = "[^"]+"', ('version = "' + $version + '"')
    [IO.File]::WriteAllText($cargoPath, $cargo, $utf8)
}

$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousNotesFile = $env:SBBH_RELEASE_NOTES_FILE
$previousEncoding = [Console]::OutputEncoding
Push-Location -LiteralPath $project
try {
    [Console]::OutputEncoding = $utf8
    if (-not $previousKey) {
        $key = (Resolve-Path -LiteralPath $KeyPath).Path
        $publicKey = (Get-Content -Raw -LiteralPath "$key.pub").Trim()
        if ($publicKey -cne $config.plugins.updater.pubkey) {
            throw 'La cle de signature ne correspond pas a la cle publique du canal.'
        }
        $env:TAURI_SIGNING_PRIVATE_KEY = $key
    } else {
        $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey.Trim()
    }
    $commit = git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Le commit du build est introuvable.' }
    $notes = Get-ReleaseNotes $commit $BaseCommit $PreviousManifest $version
    $output = Join-Path $project "src-tauri/target/github-release/v$version"
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $env:SBBH_RELEASE_NOTES_FILE = Join-Path $output 'release-notes.md'
    [IO.File]::WriteAllText($env:SBBH_RELEASE_NOTES_FILE, $notes, $utf8)
    $buildArgs = @('build', '--bundles', 'nsis', '--config', 'src-tauri/installer/updates.json')
    if ($UseNpmCli) {
        npm exec --yes --package=@tauri-apps/cli@2.12.6 -- tauri @buildArgs
    } else {
        cargo tauri @buildArgs
    }
    if ($LASTEXITCODE -ne 0) { throw 'La compilation signee a echoue.' }
} finally {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
    $env:SBBH_RELEASE_NOTES_FILE = $previousNotesFile
    [Console]::OutputEncoding = $previousEncoding
    Pop-Location
}

$source = Join-Path $project "src-tauri/target/release/bundle/nsis/$($config.productName)_${version}_x64-setup.exe"
$signature = (Get-Content -Raw -LiteralPath "$source.sig").Trim()
if (-not $signature) { throw "La signature de l'installateur est vide." }
$signatureLines = $utf8.GetString([Convert]::FromBase64String($signature)) -split '\r?\n'
$keyLines = $utf8.GetString([Convert]::FromBase64String($config.plugins.updater.pubkey)) -split '\r?\n'
$signatureBytes = [Convert]::FromBase64String($signatureLines[1])
$keyBytes = [Convert]::FromBase64String($keyLines[1])
if ([BitConverter]::ToUInt64($signatureBytes, 2) -ne [BitConverter]::ToUInt64($keyBytes, 2) -or
    ($signatureLines[2] -split "`t") -cnotcontains "version:$version") {
    throw 'La signature ne correspond pas a la cle publique ou a la version du canal.'
}

$tag = 'rolling'
$installer = "Black-Hole_${version}_x64-setup.exe"
$manifest = [ordered]@{
    version = $version.ToString()
    notes = $notes
    notes_format = 1
    commit = $commit
    platforms = @{
        'windows-x86_64' = @{
            url = "https://github.com/fighter380/Blak-Hole/releases/download/$tag/$installer"
            signature = $signature
        }
    }
} | ConvertTo-Json -Depth 4

Copy-Item -LiteralPath $source -Destination (Join-Path $output $installer)
Copy-Item -LiteralPath "$source.sig" -Destination (Join-Path $output "$installer.sig")
[IO.File]::WriteAllText((Join-Path $output 'latest.json'), "$manifest`n", $utf8)
if ($env:GITHUB_OUTPUT) { "version=$version" >> $env:GITHUB_OUTPUT }
Write-Output "GitHub Release $tag : $output"
