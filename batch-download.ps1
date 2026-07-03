$ErrorActionPreference = "Continue"

$cliPath = "C:\Users\smadmin\Desktop\Semir_yunpanSearch\semir-yunpan-cli\dist\cli.js"
$cloudBase = "巴拉货控/02 产品上新模块/2-2 巴拉产品上新"
$outputBase = "E:\巴拉巴拉\搜推\图片导出_test_7.1"
$mountId = "2023"
$maxPerCode = 10
$priorityKeywords = @("yz", "o", "ys")

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
  Write-Host "`n=== 处理款号: $code ===" -ForegroundColor Cyan

  $codeDir = Join-Path $outputBase $code
  if (-not (Test-Path $codeDir)) {
    New-Item -ItemType Directory -Path $codeDir -Force | Out-Null
  }

  try {
    $searchOutput = & node $cliPath search $code -m $mountId -p $cloudBase --ext image -l 200 -f json 2>&1
    $searchJson = ($searchOutput | Out-String).Trim()

    if ($LASTEXITCODE -ne 0) {
      Write-Host "  [警告] 搜索可能无结果" -ForegroundColor Yellow
      $files = @()
    } else {
      $files = $searchJson | ConvertFrom-Json
    }

    Write-Host "  搜索到 $($files.Count) 张图片"

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
        keyword = $keyword
        ext = $f.ext
        filesize = $f.filesize
      }
    }

    $sorted = $scored | Sort-Object priority
    $selected = $sorted | Select-Object -First $maxPerCode

    $yzCount = ($selected | Where-Object { $_.keyword -eq "yz" }).Count
    $oCount = ($selected | Where-Object { $_.keyword -eq "o" }).Count
    $ysCount = ($selected | Where-Object { $_.keyword -eq "ys" }).Count
    $otherCount = ($selected | Where-Object { $_.priority -eq 99 }).Count

    Write-Host "  筛选后 $($selected.Count) 张 (yz=$yzCount, o=$oCount, ys=$ysCount, 其他=$otherCount)"

    $downloaded = 0
    $failed = 0

    foreach ($item in $selected) {
      try {
        $destFile = Join-Path $codeDir $item.filename
        & node $cliPath download $item.fullpath -m $mountId -o $destFile 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $destFile)) {
          $downloaded++
          $sizeMB = [math]::Round((Get-Item $destFile).Length / 1MB, 1)
          Write-Host "  [OK] $($item.filename) ($sizeMB MB) [$($item.keyword)]" -ForegroundColor Green
        } else {
          $failed++
          Write-Host "  [失败] $($item.filename)" -ForegroundColor Red
        }
      } catch {
        $failed++
        Write-Host "  [失败] $($item.filename): $($_.Exception.Message)" -ForegroundColor Red
      }
    }

    $report += [PSCustomObject]@{
      款号 = $code
      搜索总数 = $files.Count
      筛选数量 = $selected.Count
      yz = $yzCount
      o = $oCount
      ys = $ysCount
      其他 = $otherCount
      下载成功 = $downloaded
      下载失败 = $failed
    }

  } catch {
    Write-Host "  [错误] $($_.Exception.Message)" -ForegroundColor Red
    $report += [PSCustomObject]@{
      款号 = $code
      搜索总数 = 0
      筛选数量 = 0
      yz = 0
      o = 0
      ys = 0
      其他 = 0
      下载成功 = 0
      下载失败 = 0
    }
  }
}

Write-Host "`n`n========== 下载报告 ==========" -ForegroundColor Magenta
$report | Format-Table -AutoSize

$report | Export-Csv -Path (Join-Path $outputBase "download_report.csv") -Encoding UTF8 -NoTypeInformation
Write-Host "报告已保存到: $(Join-Path $outputBase 'download_report.csv')"
