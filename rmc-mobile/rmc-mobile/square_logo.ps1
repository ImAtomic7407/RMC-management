Add-Type -AssemblyName System.Drawing
$imagePath = "A:\RMC_Local_Installer\rmc-mobile\assets\rmc-logo.png"
$outputPath = "A:\RMC_Local_Installer\rmc-mobile\assets\rmc-logo-square.png"
$img = [System.Drawing.Image]::FromFile($imagePath)
$newImg = New-Object System.Drawing.Bitmap(1024, 1024)
$g = [System.Drawing.Graphics]::FromImage($newImg)
$g.Clear([System.Drawing.Color]::White)
$ratio = [Math]::Min(1024 / $img.Width, 1024 / $img.Height)
$newWidth = [int]($img.Width * $ratio)
$newHeight = [int]($img.Height * $ratio)
$posX = [int]((1024 - $newWidth) / 2)
$posY = [int]((1024 - $newHeight) / 2)
$g.DrawImage($img, $posX, $posY, $newWidth, $newHeight)
$newImg.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
$newImg.Dispose()
$g.Dispose()
Write-Host "Logo squared and saved to $outputPath"
