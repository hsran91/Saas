param(
  [string]$BaseUrl = "http://localhost:5000",
  [string]$Username = "",
  [string]$Password = "",
  [string]$TenantId = "",
  [switch]$SkipMismatchCheck
)

$ErrorActionPreference = "Stop"

function Write-Pass($message) {
  Write-Host "[PASS] $message" -ForegroundColor Green
}

function Write-Fail($message) {
  Write-Host "[FAIL] $message" -ForegroundColor Red
}

function Write-Info($message) {
  Write-Host "[INFO] $message" -ForegroundColor Cyan
}

function Decode-JwtPayload([string]$token) {
  if (-not $token) { throw "JWT token is empty." }

  $parts = $token.Split(".")
  if ($parts.Length -lt 2) { throw "Invalid JWT format." }

  $payload = $parts[1].Replace('-', '+').Replace('_', '/')
  switch ($payload.Length % 4) {
    2 { $payload += "==" }
    3 { $payload += "=" }
  }

  $bytes = [System.Convert]::FromBase64String($payload)
  $json = [System.Text.Encoding]::UTF8.GetString($bytes)
  return ($json | ConvertFrom-Json)
}

function Invoke-CheckRequest {
  param(
    [string]$Name,
    [string]$Uri,
    [hashtable]$Headers
  )

  try {
    $result = Invoke-RestMethod -Method GET -Uri $Uri -Headers $Headers
    Write-Pass "$Name succeeded"
    return [PSCustomObject]@{ Success = $true; Result = $result }
  } catch {
    Write-Fail "$Name failed: $($_.Exception.Message)"
    return [PSCustomObject]@{ Success = $false; Result = $null }
  }
}

if (-not $Username) {
  $Username = Read-Host "Enter username"
}
if (-not $Password) {
  $Password = Read-Host "Enter password"
}

Write-Info "Logging in to $BaseUrl/auth/login"
$loginPayload = @{
  username = $Username
  password = $Password
}
if ($TenantId) {
  $loginPayload.tenantId = $TenantId
}

$token = $null
$jwt = $null
$resolvedTenantId = $null

try {
  $loginResponse = Invoke-RestMethod -Method POST -Uri "$BaseUrl/auth/login" -ContentType "application/json" -Body ($loginPayload | ConvertTo-Json)
  $token = $loginResponse.token
  if (-not $token) {
    throw "Login response did not include token."
  }
  Write-Pass "Login succeeded"
} catch {
  Write-Fail "Login failed: $($_.Exception.Message)"
  exit 1
}

try {
  $jwt = Decode-JwtPayload -token $token
  if (-not $jwt.tenantId) {
    throw "tenantId missing from JWT payload"
  }
  $resolvedTenantId = [string]$jwt.tenantId
  Write-Pass "JWT contains tenantId: $resolvedTenantId"
} catch {
  Write-Fail "JWT validation failed: $($_.Exception.Message)"
  exit 1
}

$headers = @{
  Authorization = "Bearer $token"
  "X-Tenant-Id" = $resolvedTenantId
}

Write-Info "Running tenant-scoped endpoint checks"
$checks = @(
  @{ Name = "GET /residents"; Uri = "$BaseUrl/residents" },
  @{ Name = "GET /dashboard"; Uri = "$BaseUrl/dashboard" },
  @{ Name = "GET /mar"; Uri = "$BaseUrl/mar" },
  @{ Name = "GET /invoices"; Uri = "$BaseUrl/invoices" },
  @{ Name = "GET /alerts/recent/all"; Uri = "$BaseUrl/alerts/recent/all?hours=72" }
)

$allPassed = $true
foreach ($check in $checks) {
  $r = Invoke-CheckRequest -Name $check.Name -Uri $check.Uri -Headers $headers
  if (-not $r.Success) { $allPassed = $false }
}

$residentList = $null
try {
  $residentList = Invoke-RestMethod -Method GET -Uri "$BaseUrl/residents" -Headers $headers
} catch {
  $residentList = $null
}

$residentId = $null
if ($residentList -is [System.Array] -and $residentList.Count -gt 0) {
  $residentId = $residentList[0]._id
} elseif ($residentList -and $residentList._id) {
  $residentId = $residentList._id
}

if ($residentId) {
  Write-Info "Running resident-scoped endpoint checks with residentId=$residentId"
  $residentChecks = @(
    @{ Name = "GET /medications/{residentId}"; Uri = "$BaseUrl/medications/$residentId" },
    @{ Name = "GET /mar/{residentId}"; Uri = "$BaseUrl/mar/$residentId" },
    @{ Name = "GET /invoices/{residentId}"; Uri = "$BaseUrl/invoices/$residentId" },
    @{ Name = "GET /alerts/{residentId}"; Uri = "$BaseUrl/alerts/$residentId?hours=72" }
  )

  foreach ($check in $residentChecks) {
    $r = Invoke-CheckRequest -Name $check.Name -Uri $check.Uri -Headers $headers
    if (-not $r.Success) { $allPassed = $false }
  }
} else {
  Write-Info "No resident records found; resident-scoped checks skipped."
}

if (-not $SkipMismatchCheck) {
  Write-Info "Running cross-tenant mismatch check (expect 403)"
  $badTenantId = if ($resolvedTenantId -eq "507f1f77bcf86cd799439011") {
    "507f191e810c19729de860ea"
  } else {
    "507f1f77bcf86cd799439011"
  }

  $badHeaders = @{
    Authorization = "Bearer $token"
    "X-Tenant-Id" = $badTenantId
  }

  try {
    Invoke-RestMethod -Method GET -Uri "$BaseUrl/residents" -Headers $badHeaders
    Write-Fail "Cross-tenant mismatch check failed: request unexpectedly succeeded"
    $allPassed = $false
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($statusCode -eq 403) {
      Write-Pass "Cross-tenant mismatch correctly rejected with 403"
    } else {
      Write-Fail "Cross-tenant mismatch returned unexpected status: $statusCode"
      $allPassed = $false
    }
  }
}

Write-Host ""
if ($allPassed) {
  Write-Host "Tenant smoke test completed successfully." -ForegroundColor Green
  exit 0
} else {
  Write-Host "Tenant smoke test completed with failures." -ForegroundColor Red
  exit 1
}
