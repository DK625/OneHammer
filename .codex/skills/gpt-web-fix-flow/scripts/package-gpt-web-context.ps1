param(
    [string]$RepoRoot = (Get-Location).Path,
    [string]$OutputDir,
    [string]$NamePrefix = 'gpt-web-context',
    [Alias('Paths')]
    [string[]]$Path,
    [string[]]$Exclude = @()
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Add-ZipFile {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$SourceFile,
        [string]$EntryName
    )

    $normalizedEntry = $EntryName.Replace('\', '/')
    $entry = $Archive.CreateEntry($normalizedEntry, [System.IO.Compression.CompressionLevel]::Optimal)
    $input = [System.IO.File]::Open(
        $SourceFile,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    )
    try {
        $output = $entry.Open()
        try {
            $input.CopyTo($output)
        } finally {
            $output.Dispose()
        }
    } finally {
        $input.Dispose()
    }
}

function ConvertTo-SafeZipSegment {
    param([string]$Segment)

    $clean = $Segment -replace '[<>:"|?*\x00-\x1F]', '_'
    $clean = $clean.Trim()
    if ([string]::IsNullOrWhiteSpace($clean) -or $clean -eq '.' -or $clean -eq '..') {
        return '_'
    }
    return $clean
}

function ConvertTo-ZipEntryPath {
    param(
        [string]$Repo,
        [string]$AbsolutePath
    )

    $repoFull = [System.IO.Path]::GetFullPath($Repo).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $pathFull = [System.IO.Path]::GetFullPath($AbsolutePath)
    $comparison = [System.StringComparison]::OrdinalIgnoreCase
    if ($pathFull.Equals($repoFull, $comparison)) {
        return 'repo-root'
    }
    if ($pathFull.StartsWith($repoFull + [System.IO.Path]::DirectorySeparatorChar, $comparison) -or
        $pathFull.StartsWith($repoFull + [System.IO.Path]::AltDirectorySeparatorChar, $comparison)) {
        return $pathFull.Substring($repoFull.Length + 1).Replace('\', '/')
    }

    $segments = New-Object System.Collections.Generic.List[string]
    $segments.Add('external')

    $root = [System.IO.Path]::GetPathRoot($pathFull)
    foreach ($segment in ($root.TrimEnd('\', '/') -split '[\\/]+')) {
        if (-not [string]::IsNullOrWhiteSpace($segment)) {
            $segments.Add((ConvertTo-SafeZipSegment -Segment $segment))
        }
    }
    if ($segments.Count -eq 1) {
        $segments.Add('root')
    }

    $tail = if ($root) { $pathFull.Substring($root.Length) } else { $pathFull }
    foreach ($segment in ($tail -split '[\\/]+')) {
        if (-not [string]::IsNullOrWhiteSpace($segment)) {
            $segments.Add((ConvertTo-SafeZipSegment -Segment $segment))
        }
    }
    return ($segments -join '/')
}

function ConvertTo-ExcludePattern {
    param(
        [string]$Repo,
        [string]$Pattern
    )

    $trimmed = $Pattern.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return $null
    }
    if ([System.IO.Path]::IsPathRooted($trimmed) -and $trimmed -notmatch '[\*\?\[]') {
        return ConvertTo-ZipEntryPath -Repo $Repo -AbsolutePath $trimmed
    }
    return $trimmed.Replace('\', '/').TrimStart('/')
}

function Test-PathInsideRoot {
    param(
        [string]$Root,
        [string]$Path
    )

    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    $comparison = [System.StringComparison]::OrdinalIgnoreCase
    return ($pathFull.Equals($rootFull, $comparison) -or
        $pathFull.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, $comparison) -or
        $pathFull.StartsWith($rootFull + [System.IO.Path]::AltDirectorySeparatorChar, $comparison))
}

function Get-GitRoot {
    param([string]$Path)

    $start = if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Split-Path -Parent ([System.IO.Path]::GetFullPath($Path))
    } else {
        [System.IO.Path]::GetFullPath($Path)
    }

    try {
        $output = & git -C $start rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -eq 0 -and $output) {
            return [System.IO.Path]::GetFullPath(($output | Select-Object -First 1).Trim()).TrimEnd('\', '/')
        }
    } catch {
        return $null
    }
    return $null
}

function ConvertTo-GitRelativePath {
    param(
        [string]$GitRoot,
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($GitRoot) -or -not (Test-PathInsideRoot -Root $GitRoot -Path $Path)) {
        return $null
    }
    $rootFull = [System.IO.Path]::GetFullPath($GitRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    if ($pathFull.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    return $pathFull.Substring($rootFull.Length + 1).Replace('\', '/')
}

function Test-GitIgnoredPath {
    param(
        [string]$GitRoot,
        [string]$Path,
        [switch]$Directory
    )

    $relative = ConvertTo-GitRelativePath -GitRoot $GitRoot -Path $Path
    if ([string]::IsNullOrWhiteSpace($relative)) {
        return $false
    }

    $queries = New-Object System.Collections.Generic.List[string]
    if ($Directory -and -not $relative.EndsWith('/')) {
        $queries.Add("$relative/")
    }
    $queries.Add($relative)

    foreach ($query in $queries) {
        try {
            & git -C $GitRoot check-ignore --no-index -q -- $query 2>$null
            if ($LASTEXITCODE -eq 0) {
                return $true
            }
        } catch {
            return $false
        }
    }
    return $false
}

function Get-GitPackageFiles {
    param(
        [string]$GitRoot,
        [System.IO.FileSystemInfo]$Item
    )

    if ([string]::IsNullOrWhiteSpace($GitRoot) -or -not (Test-PathInsideRoot -Root $GitRoot -Path $Item.FullName)) {
        return
    }

    if ($Item -is [System.IO.FileInfo]) {
        if (-not (Test-GitIgnoredPath -GitRoot $GitRoot -Path $Item.FullName)) {
            $Item
        }
        return
    }

    $relative = ConvertTo-GitRelativePath -GitRoot $GitRoot -Path $Item.FullName
    $pathspec = if ([string]::IsNullOrWhiteSpace($relative)) { '.' } else { $relative }

    try {
        $listed = & git -C $GitRoot ls-files --cached --others --exclude-standard -- $pathspec 2>$null
        if ($LASTEXITCODE -ne 0) {
            return
        }
    } catch {
        return
    }

    foreach ($relativeFile in $listed) {
        if ([string]::IsNullOrWhiteSpace($relativeFile)) {
            continue
        }
        $nativeRelative = $relativeFile.Replace('/', [string][System.IO.Path]::DirectorySeparatorChar)
        $fullPath = Join-Path $GitRoot $nativeRelative
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            Get-Item -LiteralPath $fullPath -Force
        }
    }
}

function Test-ExcludedPath {
    param(
        [string]$RelativePath,
        [string[]]$Patterns
    )

    $normalized = $RelativePath.Replace('\', '/')
    foreach ($pattern in $Patterns) {
        $normalizedPattern = $pattern.Replace('\', '/').TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($normalizedPattern)) {
            continue
        }
        if ($normalized.Equals($normalizedPattern, [System.StringComparison]::OrdinalIgnoreCase) -or
            $normalized.StartsWith($normalizedPattern.TrimEnd('/') + '/', [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
        $wildcard = [System.Management.Automation.WildcardPattern]::new(
            $normalizedPattern,
            [System.Management.Automation.WildcardOptions]::IgnoreCase
        )
        if ($wildcard.IsMatch($normalized)) {
            return $true
        }
    }
    return $false
}

if (-not $Path -or $Path.Count -eq 0) {
    throw "No paths specified. Pass -Path with project-relative or absolute folders/files, or configure oracle_runtime.local.json active_path. If neither is available, ask the user what to zip for GPT Web."
}

$repo = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\', '/')
if (-not $OutputDir) {
    $OutputDir = Join-Path $repo 'my_build\archive\gpt-web-context'
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$excludePatterns = @($Exclude | ForEach-Object {
    ConvertTo-ExcludePattern -Repo $repo -Pattern $_
} | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

function Get-PackageFiles {
    param(
        [System.IO.DirectoryInfo]$Root,
        [string]$Repo,
        [string[]]$ExcludePatterns,
        [string]$GitRoot
    )

    $pending = New-Object 'System.Collections.Generic.Stack[System.IO.DirectoryInfo]'
    $pending.Push($Root)
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($subdir in @(Get-ChildItem -LiteralPath $directory.FullName -Directory -Force | Sort-Object FullName)) {
            $entry = ConvertTo-ZipEntryPath -Repo $Repo -AbsolutePath $subdir.FullName
            if ((Test-ExcludedPath -RelativePath $entry -Patterns $ExcludePatterns) -or
                (Test-GitIgnoredPath -GitRoot $GitRoot -Path $subdir.FullName -Directory)) {
                continue
            }
            $pending.Push($subdir)
        }
        foreach ($file in @(Get-ChildItem -LiteralPath $directory.FullName -File -Force | Sort-Object FullName)) {
            $file
        }
    }
}

$sourceByEntry = @{}
foreach ($requested in $Path) {
    if ([string]::IsNullOrWhiteSpace($requested)) {
        continue
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($requested)) {
        $requested
    } else {
        Join-Path $repo $requested
    }

    if (-not (Test-Path -LiteralPath $candidate)) {
        throw "Requested path not found: $requested"
    }

    $item = Get-Item -LiteralPath $candidate -Force
    $gitRoot = Get-GitRoot -Path $item.FullName
    if (-not [string]::IsNullOrWhiteSpace($gitRoot) -and (Test-PathInsideRoot -Root $gitRoot -Path $item.FullName)) {
        foreach ($sourceFile in @(Get-GitPackageFiles -GitRoot $gitRoot -Item $item)) {
            $entry = ConvertTo-ZipEntryPath -Repo $repo -AbsolutePath $sourceFile.FullName
            if (-not ((Test-ExcludedPath -RelativePath $entry -Patterns $excludePatterns) -or
                (Test-GitIgnoredPath -GitRoot $gitRoot -Path $sourceFile.FullName))) {
                $sourceByEntry[$entry] = $sourceFile.FullName
            }
        }
        continue
    }
    if ($item -is [System.IO.DirectoryInfo]) {
        if (Test-GitIgnoredPath -GitRoot $gitRoot -Path $item.FullName -Directory) {
            continue
        }
        Get-PackageFiles -Root $item -Repo $repo -ExcludePatterns $excludePatterns -GitRoot $gitRoot | ForEach-Object {
            $entry = ConvertTo-ZipEntryPath -Repo $repo -AbsolutePath $_.FullName
            if (-not ((Test-ExcludedPath -RelativePath $entry -Patterns $excludePatterns) -or
                (Test-GitIgnoredPath -GitRoot $gitRoot -Path $_.FullName))) {
                $sourceByEntry[$entry] = $_.FullName
            }
        }
    } else {
        $entry = ConvertTo-ZipEntryPath -Repo $repo -AbsolutePath $item.FullName
        if ((Test-ExcludedPath -RelativePath $entry -Patterns $excludePatterns) -or
            (Test-GitIgnoredPath -GitRoot $gitRoot -Path $item.FullName)) {
            continue
        }
        $sourceByEntry[$entry] = $item.FullName
    }
}

if ($sourceByEntry.Count -eq 0) {
    throw "No files matched the requested paths after exclusions."
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$zipPath = Join-Path $OutputDir "$NamePrefix-$timestamp.zip"
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($entry in ($sourceByEntry.Keys | Sort-Object)) {
        Add-ZipFile -Archive $archive -SourceFile $sourceByEntry[$entry] -EntryName $entry
    }
} finally {
    $archive.Dispose()
}

$zipItem = Get-Item -LiteralPath $zipPath
$sizeMb = [Math]::Round($zipItem.Length / 1MB, 2)

Write-Host "Created GPT Web context zip:"
Write-Host $zipItem.FullName
Write-Host "Files: $($sourceByEntry.Count)"
Write-Host "Size: $sizeMb MB"
Write-Host "Roots: $($Path -join ', ')"
