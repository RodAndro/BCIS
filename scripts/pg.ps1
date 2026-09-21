<#
.SYNOPSIS
    Manages the local PostgreSQL 17 cluster used for BCIS development.

.DESCRIPTION
    Runs PostgreSQL from the official EnterpriseDB portable binaries in
    .runtime/pgsql, with its data directory in .runtime/pgdata (: no Windows
    service, no administrator rights, nothing installed system-wide.

    This is a DEVELOPMENT convenience only. The Phase 9 three-PC deployment
    uses a properly installed PostgreSQL service with its own credentials and
    a restricted application role. Nothing in this script is intended to run
    in production.

    Commands:
        start   Initialise if needed, start the server, ensure role + databases
        stop    Stop the server
        status  Report whether the server is running
        init    Initialise the cluster and the application role (no start)
        reset   Destroy the data directory and rebuild from scratch
        psql    Open a psql session against the development database

.PARAMETER Command
    One of: start | stop | status | init | reset | psql

.PARAMETER Force
    Required by `reset`, because reset destroys all local development data.

.EXAMPLE
    pnpm pg:start
    pnpm db:migrate
    pnpm dev
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'status', 'init', 'reset', 'psql')]
    [string]$Command = 'status',

    [Parameter()]
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- Configuration ---------------------------------------------------------
# Port 5433 rather than 5432 so this never collides with a PostgreSQL service
# that someone may already have installed on the workstation.
$Port              = 5433
$SuperUserName     = 'postgres'
$SuperUserPassword = 'postgres_superuser_dev'
$AppUserName       = 'bcis'
$AppUserPassword   = 'bcis_dev_password'
$Databases         = @('bcis', 'bcis_test')

# --- Paths -----------------------------------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RepoRoot '.runtime'
$PgRoot     = Join-Path $RuntimeDir 'pgsql'
$PgBin      = Join-Path $PgRoot 'bin'
$PgData     = Join-Path $RuntimeDir 'pgdata'
$PgLog      = Join-Path $RuntimeDir 'postgres.log'

function Assert-Binaries {
    $required = @('initdb.exe', 'pg_ctl.exe', 'psql.exe', 'postgres.exe')
    foreach ($exe in $required) {
        if (-not (Test-Path (Join-Path $PgBin $exe))) {
            throw "PostgreSQL binaries not found at $PgBin. Expected $exe. Re-run the runtime setup."
        }
    }
}

function Test-Initialised {
    return Test-Path (Join-Path $PgData 'PG_VERSION')
}

function Test-Running {
    if (-not (Test-Initialised)) { return $false }
    & (Join-Path $PgBin 'pg_ctl.exe') status -D $PgData *> $null
    return $LASTEXITCODE -eq 0
}

function Invoke-PgCtl {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & (Join-Path $PgBin 'pg_ctl.exe') @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "pg_ctl $($Arguments -join ' ') failed:`n$output"
    }
    return $output
}

function Invoke-Psql {
    param(
        [Parameter(Mandatory)][string]$Database,
        [Parameter(Mandatory)][string]$Sql,
        [string]$User = $SuperUserName,
        [string]$Password = $SuperUserPassword
    )

    $previousPassword = $env:PGPASSWORD
    $env:PGPASSWORD = $Password

    try {
        # --no-password would be stricter, but psql exits rather than prompting
        # because a password is supplied, and PGPASSWORD is cleared in `finally`
        # so it cannot leak into a later process in the same session.
        $output = & (Join-Path $PgBin 'psql.exe') `
            --host 127.0.0.1 --port $Port --username $User --dbname $Database `
            --no-psqlrc --quiet --no-align --tuples-only `
            --set ON_ERROR_STOP=1 --command $Sql 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "psql failed against $Database`:$output"
        }
        return ($output | Out-String).Trim()
    }
    finally {
        $env:PGPASSWORD = $previousPassword
    }
}

function Initialize-Cluster {
    if (Test-Initialised) {
        Write-Host "Cluster already initialised at $PgData"
        return
    }

    Write-Host "Initialising PostgreSQL cluster at $PgData ..."

    # initdb takes the superuser password from a file rather than the command
    # line, so the password never appears in the process list.
    $passwordFile = Join-Path $env:TEMP ("bcis-pg-pw-" + [guid]::NewGuid().ToString('N') + ".txt")
    Set-Content -Path $passwordFile -Value $SuperUserPassword -NoNewline -Encoding ascii

    try {
        $output = & (Join-Path $PgBin 'initdb.exe') `
            --pgdata=$PgData `
            --username=$SuperUserName `
            --pwfile=$passwordFile `
            --encoding=UTF8 `
            --locale=C `
            --auth-host=scram-sha-256 `
            --auth-local=scram-sha-256 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "initdb failed:`n$output"
        }
    }
    finally {
        Remove-Item $passwordFile -Force -ErrorAction SilentlyContinue
    }

    # Bind to loopback only. This cluster must never be reachable from the LAN.
    Add-Content -Path (Join-Path $PgData 'postgresql.conf') -Value @"

# --- BCIS development overrides -------------------------------------------
listen_addresses = '127.0.0.1'
port = $Port
# Log slow statements so a missing index on a 500k-row table is visible.
log_min_duration_statement = 500
"@

    Write-Host "Cluster initialised."
}

function Start-Cluster {
    if (Test-Running) {
        Write-Host "PostgreSQL is already running on port $Port."
        return
    }

    Initialize-Cluster

    Write-Host "Starting PostgreSQL on port $Port ..."

    # ── WHY UseShellExecute, AND WHY NO REDIRECTION ─────────────────────────
    # Three Windows traps were hit while building this, all with the same root
    # cause: a long-lived postmaster holding handles it inherited.
    #
    #   1. `pg_ctl start` piped into a PowerShell pipeline: a capturing caller
    #      waits forever for an EOF that postgres never emits.
    #   2. `Start-Process -Wait` with redirection: -Wait blocks until the
    #      redirected streams close, which never happens.
    #   3. `Start-Process` WITHOUT -Wait but WITH -RedirectStandardOutput:
    #      PowerShell creates a pipe it must drain. postgres inherits the write
    #      end, so the drain never completes and the PowerShell PROCESS cannot
    #      exit. The server starts perfectly and the script hangs anyway.
    #
    # `Process.Start` with UseShellExecute = $true goes through ShellExecuteEx,
    # which creates the child WITHOUT inheriting this process's handles. That
    # removes the entire class of problem. pg_ctl's own `-l` switch sends the
    # server's output to a log file, so nothing is lost.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $PgBin 'pg_ctl.exe'
    $psi.Arguments = 'start -D "{0}" -l "{1}" -w -t 60' -f $PgData, $PgLog
    $psi.UseShellExecute = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

    [System.Diagnostics.Process]::Start($psi) | Out-Null

    if (-not (Wait-ForReady)) {
        $detail = ''
        if (Test-Path $PgLog) {
            $detail = (Get-Content $PgLog -Tail 25 | Out-String)
        }
        throw "PostgreSQL did not become ready on port $Port within 30 seconds.`n$detail"
    }

    Write-Host "PostgreSQL started. Log: $PgLog"
}

function Wait-ForReady {
    # pg_ctl -w already waits, but confirming with an actual connection means a
    # "started" message is never printed for a server that cannot be reached.
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        & (Join-Path $PgBin 'pg_isready.exe') --host 127.0.0.1 --port $Port --dbname postgres *> $null
        if ($LASTEXITCODE -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Initialize-ApplicationRole {
    # Idempotent: safe to run on every start.
    $roleExists = (Invoke-Psql -Database 'postgres' -Sql "SELECT 1 FROM pg_roles WHERE rolname = '$AppUserName'").Trim()
    if ($roleExists -ne '1') {
        Write-Host "Creating role $AppUserName ..."
        Invoke-Psql -Database 'postgres' -Sql "CREATE ROLE $AppUserName LOGIN PASSWORD '$AppUserPassword'" | Out-Null
    }

    foreach ($db in $Databases) {
        $dbExists = (Invoke-Psql -Database 'postgres' -Sql "SELECT 1 FROM pg_database WHERE datname = '$db'").Trim()
        if ($dbExists -ne '1') {
            Write-Host "Creating database $db ..."
            # CREATE DATABASE cannot run inside a transaction block, and cannot
            # be parameterised, so the name is interpolated from a fixed list.
            Invoke-Psql -Database 'postgres' -Sql "CREATE DATABASE $db OWNER $AppUserName ENCODING 'UTF8'" | Out-Null
        }

        # The application role owns the database but must not be able to create
        # arbitrary objects in the public schema at runtime; migrations run as
        # the owner and grant what is needed.
        Invoke-Psql -Database $db -Sql "GRANT ALL ON SCHEMA public TO $AppUserName" | Out-Null
    }

    Write-Host "Application role and databases are ready."
}

function Show-Status {
    if (Test-Running) {
        Invoke-PgCtl -Arguments @('status', '-D', $PgData)
    }
    else {
        Write-Host "PostgreSQL is not running."
        if (-not (Test-Initialised)) {
            Write-Host "The cluster has not been initialised yet. Run: pnpm pg:start"
        }
    }
}

# --- Dispatch --------------------------------------------------------------
switch ($Command) {
    'init' {
        Assert-Binaries
        Initialize-Cluster
        Start-Cluster
        Initialize-ApplicationRole
    }
    'start' {
        Assert-Binaries
        Start-Cluster
        Initialize-ApplicationRole
    }
    'stop' {
        Assert-Binaries
        if (Test-Running) {
            $stopOutLog = Join-Path $RuntimeDir 'pgctl.out.log'
            $stopErrLog = Join-Path $RuntimeDir 'pgctl.err.log'

            $pgCtl = Start-Process -FilePath (Join-Path $PgBin 'pg_ctl.exe') `
                -ArgumentList @('stop', '-D', $PgData, '-m', 'fast', '-w', '-t', '60') `
                -WindowStyle Hidden -Wait -PassThru `
                -RedirectStandardOutput $stopOutLog `
                -RedirectStandardError $stopErrLog

            if ($pgCtl.ExitCode -ne 0) {
                throw "pg_ctl could not stop PostgreSQL (exit code $($pgCtl.ExitCode)). See $stopErrLog"
            }
            Write-Host "PostgreSQL stopped."
        }
        else {
            Write-Host "PostgreSQL is not running."
        }
    }
    'status' {
        Show-Status
    }
    'reset' {
        Assert-Binaries
        if (-not $Force) {
            throw "reset destroys all local development data. Re-run with -Force to confirm."
        }
        if (Test-Running) {
            $resetOutLog = Join-Path $RuntimeDir 'pgctl.out.log'
            $resetErrLog = Join-Path $RuntimeDir 'pgctl.err.log'

            Start-Process -FilePath (Join-Path $PgBin 'pg_ctl.exe') `
                -ArgumentList @('stop', '-D', $PgData, '-m', 'immediate', '-w', '-t', '60') `
                -WindowStyle Hidden -Wait `
                -RedirectStandardOutput $resetOutLog `
                -RedirectStandardError $resetErrLog | Out-Null
        }
        if (Test-Path $PgData) {
            Remove-Item $PgData -Recurse -Force
        }
        Initialize-Cluster
        Start-Cluster
        Initialize-ApplicationRole
        Write-Host "Cluster reset. Run 'pnpm db:migrate' to rebuild the schema."
    }
    'psql' {
        Assert-Binaries
        $env:PGPASSWORD = $AppUserPassword
        & (Join-Path $PgBin 'psql.exe') --host 127.0.0.1 --port $Port --username $AppUserName --dbname 'bcis'
    }
}
