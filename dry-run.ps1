$ErrorActionPreference = "Continue"

$cliPath = "C:\Users\smadmin\Desktop\Semir_yunpanSearch\semir-yunpan-cli\dist\cli.js"
$cloudBase = "巴拉货控/02 产品上新模块/2-2 巴拉产品上新"
$mountId = "2023"
$maxPerCode = 10
$priorityKeywords = @("yz", "o", "ys")

Write-Host "DEBUG: cliPath = $cliPath"
Write-Host "DEBUG: cloudBase = $cloudBase"
Write-Host "DEBUG: mountId = $mountId"
Write-Host "DEBUG: cloudBase length = $($cloudBase.Length)"
Write-Host "DEBUG: cloudBase bytes = $([System.Text.Encoding]::UTF8.GetByteCount($cloudBase))"

$codes = @(
  "209326133201",
  "208326100017",
  "208326123001",
  "208326105208",
  "208326100207",
  "208326105203",
  "208326101203"
)

$report = @()

foreach ($code in $codes) {
  Write-Host "=== code: $code ===" -ForegroundColor Cyan

  try {
    $searchOutput = & node $cliPath search $code -m $mountId -p $cloudBase --ext image -l 200 -f json 2>&1
    $exitCode = $LASTEXITCODE
    Write-Host "  DEBUG: exitCode=$exitCode, output lines=$($searchOutput.Count)"
    Write-Host "  DEBUG: first 3 lines:"
    $searchOutput | Select-Object -First 3 | ForEach-Object { Write-Host "    $_" }
    $searchJson = ($searchOutput | Where-Object { $_ -match '^\s*[\[\{"]' } | Out-String).Trim()

    if ($exitCode -ne 0 -or -not $searchJson) {
      Write-Host "  [EMPTY] no results (exit=$exitCode)" -ForegroundColor Yellow
      $files = @()
    } else {
      $files = $searchJson | ConvertFrom-Json
    }

    Write-Host "  found: $($files.Count) images"

    $scored = @()
    foreach ($f in $files) {
      $nameLower = $f.filename.ToLower()
      $priority = 99
      $keyword = ""
      for ($i = 0; $i -lt $priorityKeywords.Count; $i++) {
        if ($nameLower -like "*$($priorityKeywords[$i])*") {
          $priority = $i
          $keyword = $priorityKeywords[$i]
          break
        }
      }
      $scored += [PSCustomObject]@{
        filename = $f.filename
        fullpath = $f.fullpath
        priority = $priority
        keyword = if ($keyword) { $keyword } else { "other" }
      }
    }

    $sorted = $scored | Sort-Object priority
    $selected = $sorted | Select-Object -First $maxPerCode

    $yzCount = ($selected | Where-Object { $_.keyword -eq "yz" }).Count
    $oCount = ($selected | Where-Object { $_.keyword -eq "o" }).Count
    $ysCount = ($selected | Where-Object { $_.keyword -eq "ys" }).Count
    $otherCount = ($selected | Where-Object { $_.keyword -eq "other" }).Count

    Write-Host "  selected: $($selected.Count) (yz=$yzCount, o=$oCount, ys=$ysCount, other=$otherCount)"
    Write-Host "  files:"
    $selected | ForEach-Object { Write-Host "    [$($_.keyword)] $($_.filename)" }

    $report += [PSCustomObject]@{
      code = $code
      total = $files.Count
      selected = $selected.Count
      yz = $yzCount
      o = $oCount
      ys = $ysCount
      other = $otherCount
    }

  } catch {
    Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
    $report += [PSCustomObject]@{
      code = $code
      total = 0
      selected = 0
      yz = 0
      o = 0
      ys = 0
      other = 0
    }
  }
}

Write-Host "`n========== SUMMARY ==========" -ForegroundColor Magenta
$report | Format-Table -AutoSize
