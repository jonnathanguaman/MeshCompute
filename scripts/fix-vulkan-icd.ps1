<#
.SYNOPSIS
  Registra el ICD de Vulkan de NVIDIA para que QVAC pueda cargar modelos.

.DESCRIPTION
  QVAC exige Vulkan en Windows INCLUSO para inferencia solo-CPU
  (https://docs.qvac.tether.io/system-requirements/).

  En este equipo el driver de NVIDIA esta instalado y trae su ICD
  (nv-vk64.json, API 1.4.312), y el loader vulkan-1.dll esta presente
  (1.4.309.0) — pero la clave del registro donde el loader busca los drivers
  NO EXISTE:

      HKLM\SOFTWARE\Khronos\Vulkan\Drivers

  Resultado: Vulkan no encuentra ningun dispositivo, y `loadModel` se queda
  girando indefinidamente sin leer un solo byte del modelo.

  Este script crea esa clave y registra el ICD. Es reversible: para deshacerlo,
  ejecutar el mismo script con -Undo.

.NOTES
  REQUIERE PERMISOS DE ADMINISTRADOR (modifica HKLM).
  Se auto-eleva mostrando el dialogo de UAC.

.EXAMPLE
  # Aplicar
  powershell -ExecutionPolicy Bypass -File scripts\fix-vulkan-icd.ps1

  # Revertir
  powershell -ExecutionPolicy Bypass -File scripts\fix-vulkan-icd.ps1 -Undo
#>

[CmdletBinding()]
param(
    [switch]$Undo
)

$ErrorActionPreference = 'Stop'
$KEY = 'HKLM:\SOFTWARE\Khronos\Vulkan\Drivers'

# ---------------------------------------------------------------- auto-elevar
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Se necesitan permisos de administrador. Pidiendo elevacion..." -ForegroundColor Yellow
    $argList = @('-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"")
    if ($Undo) { $argList += '-Undo' }
    Start-Process powershell -Verb RunAs -ArgumentList $argList
    return
}

Write-Host ""
Write-Host "=== Registro del ICD de Vulkan para QVAC ===" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------------- revertir
if ($Undo) {
    if (Test-Path $KEY) {
        Remove-Item $KEY -Recurse -Force
        Write-Host "Clave eliminada: $KEY" -ForegroundColor Green
        Write-Host "El sistema queda como estaba antes."
    } else {
        Write-Host "La clave no existe; no hay nada que revertir."
    }
    Write-Host ""
    Read-Host "Pulsa Enter para cerrar"
    return
}

# --------------------------------------------------- localizar el ICD instalado
Write-Host "Buscando ICDs de Vulkan en el DriverStore..."
$icds = @()
$icds += Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Filter 'nv-vk64.json' -Recurse -ErrorAction SilentlyContinue
$icds += Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Filter 'amd*vlk*.json' -Recurse -ErrorAction SilentlyContinue
$icds += Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Filter 'amdvlk64.json' -Recurse -ErrorAction SilentlyContinue

if ($icds.Count -eq 0) {
    Write-Host "No se encontro ningun ICD de Vulkan en el DriverStore." -ForegroundColor Red
    Write-Host "El driver grafico no incluye soporte Vulkan, o no esta instalado."
    Write-Host "Solucion: reinstalar el driver de NVIDIA con 'instalacion limpia'."
    Write-Host ""
    Read-Host "Pulsa Enter para cerrar"
    return
}

# Nos quedamos con el ICD mas reciente de cada tipo, validando que su DLL exista.
$valid = @()
foreach ($icd in ($icds | Sort-Object LastWriteTime -Descending)) {
    try {
        $json = Get-Content $icd.FullName -Raw | ConvertFrom-Json
        $lib = $json.ICD.library_path
        $dllPath = if ([System.IO.Path]::IsPathRooted($lib)) { $lib }
                   else { Join-Path $icd.DirectoryName ($lib -replace '^\.\\','') }
        if (Test-Path $dllPath) {
            $valid += [pscustomobject]@{
                Json = $icd.FullName
                Api  = $json.ICD.api_version
                Dll  = $dllPath
            }
        }
    } catch { }
}

if ($valid.Count -eq 0) {
    Write-Host "Se encontraron ICDs pero ninguno con su DLL accesible." -ForegroundColor Red
    Write-Host "Solucion: reinstalar el driver con 'instalacion limpia'."
    Write-Host ""
    Read-Host "Pulsa Enter para cerrar"
    return
}

Write-Host ""
Write-Host "ICDs validos encontrados:" -ForegroundColor Green
foreach ($v in $valid) {
    Write-Host "   API $($v.Api)  ->  $($v.Json)"
}

# ------------------------------------------------------------------- registrar
Write-Host ""
if (-not (Test-Path $KEY)) {
    New-Item -Path $KEY -Force | Out-Null
    Write-Host "Clave creada: $KEY"
} else {
    Write-Host "La clave ya existia: $KEY"
}

foreach ($v in $valid) {
    # El loader espera: nombre = ruta al json, valor DWORD 0 = habilitado
    New-ItemProperty -Path $KEY -Name $v.Json -PropertyType DWord -Value 0 -Force | Out-Null
    Write-Host "   registrado: $($v.Json)" -ForegroundColor Green
}

# -------------------------------------------------------------- verificar
Write-Host ""
Write-Host "=== estado final ===" -ForegroundColor Cyan
$k = Get-Item $KEY
foreach ($n in $k.GetValueNames()) {
    Write-Host "   $n = $($k.GetValue($n))  (0 = habilitado)"
}

Write-Host ""
Write-Host "LISTO." -ForegroundColor Green
Write-Host ""
Write-Host "Ahora, en una terminal NUEVA del proyecto, comprueba:" -ForegroundColor Yellow
Write-Host "   pnpm qvac:doctor"
Write-Host "   -> 'gpu devices' deberia dejar de ser 0"
Write-Host ""
Write-Host "   pnpm tsx spikes/load-local.ts demo-llm"
Write-Host "   -> deberia imprimir 'loaded in <n> ms' y responder"
Write-Host ""
Write-Host "Para deshacer este cambio:" -ForegroundColor DarkGray
Write-Host "   powershell -ExecutionPolicy Bypass -File scripts\fix-vulkan-icd.ps1 -Undo"
Write-Host ""
Read-Host "Pulsa Enter para cerrar"
