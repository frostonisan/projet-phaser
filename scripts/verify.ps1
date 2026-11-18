$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$siteRoot = Join-Path $root "docs"

$nodeCandidates = @(
    "C:\Users\Utilisateur\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
    "node"
)

$node = $null
foreach ($candidate in $nodeCandidates) {
    try {
        $resolved = Get-Command $candidate -ErrorAction Stop
        $node = $resolved.Source
        break
    } catch {
        if (Test-Path -LiteralPath $candidate) {
            $node = $candidate
            break
        }
    }
}

if (-not $node) {
    throw "Node.js introuvable. Installe Node.js ou lance la verification depuis Codex."
}

Write-Host "Verification syntaxe JavaScript..."
Get-ChildItem -Path (Join-Path $siteRoot "js") -Filter "*.js" -File -Recurse | ForEach-Object {
    & $node --check $_.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Write-Host "Tests de regression du verificateur d'assets..."
& $node --test (Join-Path $PSScriptRoot "verify-assets.test.mjs")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Verification des regles de vol..."
& $node --test (Join-Path $PSScriptRoot "verify-flight-rules.test.mjs")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Verification imports et assets statiques..."
& $node (Join-Path $PSScriptRoot "verify-assets.mjs") $siteRoot
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Verification OK."
