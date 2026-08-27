<#
    Windows clipboard reader.

    Usage:  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -STA
                           -File clipboard-read.ps1 <stagingDir>
    Output: one JSON object on stdout, per src/clipboard/types.ts.

    -STA is not optional: the Windows clipboard API is single-threaded-apartment
    only, and PowerShell started MTA returns nothing at all.

    The JSON is written by hand rather than with ConvertTo-Json for two reasons:
    ConvertTo-Json unwraps single-element arrays in some PowerShell versions,
    which would break the contract's `paths` array, and everything non-ASCII is
    emitted as \uXXXX escapes so the console code page (GBK on a Chinese
    Windows, for instance) cannot corrupt a file name on the way out.
#>

param(
    [Parameter(Mandatory = $true)]
    [string] $StagingDir
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# JSON output, ASCII only
# ---------------------------------------------------------------------------

function ConvertTo-JsonString {
    param([string] $Value)

    $builder = New-Object System.Text.StringBuilder
    [void] $builder.Append('"')
    foreach ($char in $Value.ToCharArray()) {
        $code = [int] $char
        switch ($char) {
            '"' { [void] $builder.Append('\"'); continue }
            '\' { [void] $builder.Append('\\'); continue }
            "`b" { [void] $builder.Append('\b'); continue }
            "`f" { [void] $builder.Append('\f'); continue }
            "`n" { [void] $builder.Append('\n'); continue }
            "`r" { [void] $builder.Append('\r'); continue }
            "`t" { [void] $builder.Append('\t'); continue }
            default {
                if ($code -lt 0x20 -or $code -gt 0x7E) {
                    [void] $builder.Append('\u').Append($code.ToString('x4'))
                } else {
                    [void] $builder.Append($char)
                }
            }
        }
    }
    [void] $builder.Append('"')
    return $builder.ToString()
}

function Write-Payload {
    param([string] $Kind, [string] $Field, [string[]] $Values)

    $items = @()
    foreach ($value in $Values) { $items += (ConvertTo-JsonString $value) }
    $joined = [string]::Join(',', $items)
    Write-Output "{`"kind`":$(ConvertTo-JsonString $Kind),`"$Field`":[$joined]}"
}

function Write-ErrorPayload {
    param([string] $Message)
    Write-Output "{`"kind`":`"error`",`"message`":$(ConvertTo-JsonString $Message)}"
}

# ---------------------------------------------------------------------------
# clipboard probes
# ---------------------------------------------------------------------------

function Get-StagedImagePath {
    # Must match STAGED_IMAGE_PATTERN in src/clipboard/index.ts, or the TTL
    # sweeper will never clean these up.
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss-fff')
    return (Join-Path $StagingDir "clipboard-$stamp.png")
}

function Test-PngMagic {
    param([byte[]] $Bytes)

    $magic = [byte[]] (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    if ($null -eq $Bytes -or $Bytes.Length -lt $magic.Length) { return $false }
    for ($i = 0; $i -lt $magic.Length; $i++) {
        if ($Bytes[$i] -ne $magic[$i]) { return $false }
    }
    return $true
}

function Save-ClipboardImage {
    param($DataObject)

    $target = Get-StagedImagePath

    # Browsers and image editors usually offer a real PNG. Taking it verbatim
    # keeps transparency and avoids a GDI+ round trip; only fall back to the
    # bitmap when no PNG flavour is on the clipboard.
    if ($DataObject.GetDataPresent('PNG')) {
        $stream = $DataObject.GetData('PNG')
        if ($stream -is [System.IO.Stream]) {
            $bytes = $null
            $buffer = New-Object System.IO.MemoryStream
            try {
                if ($stream.CanSeek) { [void] $stream.Seek(0, [System.IO.SeekOrigin]::Begin) }
                $stream.CopyTo($buffer)
                $bytes = $buffer.ToArray()
            } finally {
                $buffer.Dispose()
                $stream.Dispose()
            }
            # The flavour claims PNG. If the bytes disagree, staging them would
            # hand an agent a file that lies about its type, so the bitmap route
            # below — which produces a real PNG — takes over instead.
            if (Test-PngMagic $bytes) {
                [System.IO.File]::WriteAllBytes($target, $bytes)
                return $target
            }
        }
    }

    $image = [System.Windows.Forms.Clipboard]::GetImage()
    if ($null -eq $image) { return $null }
    try {
        $image.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $image.Dispose()
    }
    return $target
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
} catch {
    Write-ErrorPayload "could not load System.Windows.Forms: $($_.Exception.Message)"
    exit 0
}

try {
    if (-not (Test-Path -LiteralPath $StagingDir)) {
        [void] (New-Item -ItemType Directory -Path $StagingDir -Force)
    }

    $data = [System.Windows.Forms.Clipboard]::GetDataObject()
    if ($null -eq $data) {
        Write-Payload 'other' 'types' @()
        exit 0
    }

    # Order matters, and matches the other platforms: a file copy wins over the
    # thumbnail some applications put alongside it, and an image copied from a
    # browser wins over the HTML that comes with it.
    if ($data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
        $paths = @($data.GetData([System.Windows.Forms.DataFormats]::FileDrop))
        if ($paths.Count -gt 0) {
            Write-Payload 'files' 'paths' $paths
            exit 0
        }
    }

    $staged = Save-ClipboardImage $data
    if ($null -ne $staged) {
        Write-Payload 'image' 'paths' @($staged)
        exit 0
    }

    Write-Payload 'other' 'types' @($data.GetFormats())
    exit 0
} catch {
    Write-ErrorPayload $_.Exception.Message
    exit 0
}
