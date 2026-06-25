# 05 - MOD-10: Environment, IoT monitoring and safe control

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 992-1106)

# 10. MOD-05 - Environment, IoT monitoring and safe control

## 10.1 Purpose

Continuously monitor house conditions, equipment and utility state while preserving safe local control and reliable operation during cloud or network outages.

## 10.2 Primary users

Caretakers, supervisors, farm managers, maintenance, veterinarian/quality, system administrators and approved controller integrators.

## 10.3 Scope

### Typical signals

Temperature, relative humidity, ammonia, carbon dioxide, static pressure, airflow, light, water flow/pressure, feed level/weight, body-weight platform, mains/generator/UPS, fan/heater/pump/auger/cooling status, door/access/tamper and optional validated camera-derived observations.

### Automation maturity

| Level | Mode | Description |
|---|---|---|
| 0 | Manual | Workers record values; certified controllers operate independently. |
| 1 | Monitor | Read-only device telemetry, quality checks, trends and alerts. |
| 2 | Advise | System recommends inspections or bounded set-point review; qualified user decides. |
| 3 | Supervised control | Authorized user sends approved, bounded, expiring commands to the local controller with confirmation and rollback. |
| 4 | Local automatic control | Validated local controller/edge executes closed-loop logic within approved limits; cloud configures and observes under change control. |

The MVP should stop at Level 1.

## 10.4 Capabilities

- Register gateways, controllers, devices, sensors and channels with serial number, firmware, location, accuracy, calibration and owner.
- Normalize vendor/protocol identifiers, timestamps, units and quality flags at the edge.
- Buffer at least 30 days of configured telemetry and replay idempotently.
- Ingest manual and automatic readings with source and receive timestamps.
- Validate range, duplicate, stale value, sudden jump, stuck signal, clock drift and sensor disagreement.
- Maintain current-state tables and time-bucketed aggregates for dashboards.
- Apply age/stage/house-specific target bands and alert profiles.
- Track calibration, reference checks, replacements and certificates.
- Monitor gateway health, queue depth, storage, clock, firmware, adapter state and last upload.
- Integrate existing controllers read-only before any command path is enabled.
- Log every recipe/configuration change, manual override and remote command with approver, bounds, duration, response and rollback.

## 10.5 Edge gateway requirements

- Industrial environmental tolerance, protected enclosure, stable power and UPS.
- Outbound encrypted connection only by default; no unrestricted inbound internet access.
- Unique device certificate or key and disabled default credentials.
- Protocol adapters for selected controller/sensor interfaces such as MQTT, Modbus or OPC UA.
- Store-and-forward with batch sequence, item idempotency key and replay diagnostics.
- Local rule execution for critical sensor loss or condition, independent siren/strobe and optional cellular fallback.
- Remote support only through approved, time-limited, audited access with signed update and rollback.
- Local read-only status page and manual export for extended outage.

## 10.6 Telemetry storage pattern

| Table | Purpose |
|---|---|
| `gateways` | Farm edge identity, site, firmware, certificate and health. |
| `devices` | Controller/meter/sensor equipment and ownership. |
| `sensor_channels` | Measured parameter, source unit, canonical unit, location and expected interval. |
| `telemetry_readings` | Raw/normalized reading, source/receive time, value, unit, quality and idempotency key. |
| `current_sensor_state` | Latest accepted value and quality for fast house views. |
| `telemetry_aggregates` | Governed minute/hour/day statistics and time-in-band. |
| `device_events` | Online/offline, reboot, firmware, fault and configuration changes. |
| `calibrations` | Method, reference, result, certificate, next due and status. |
| `controller_recipes` / `recipe_versions` | Approved configuration definition and applicability. |
| `control_commands` | Requested command, limits, approver, expiry, controller response and rollback. |

For high volume, use PostgreSQL time partitioning and retention/aggregation policies. Dashboards read current and aggregate tables rather than scanning raw telemetry. A separate time-series or stream-processing service should be introduced only after measured workload demonstrates the need.

## 10.7 Cloud rule and local rule boundary

- **Local controller/edge:** immediate life-support logic, interlocks, emergency set points, siren/strobe and manual control.
- **Cloud:** contextual analytics, non-critical detection, notification, workflow, historical comparison and configuration governance.
- A cloud alert may never claim equipment was controlled unless the local controller confirmed execution.
- When telemetry is stale, dashboards and rules display uncertainty and use approved fallback/manual workflows.

## 10.8 UI and routes

- `/environment`
- `/sites/[siteId]/environment`
- `/houses/[houseId]/environment`
- `/devices`
- `/devices/[deviceId]`
- `/calibrations`
- `/controller-recipes`
- `/control-commands`
- `/gateways`

Client Components render interactive charts and narrow live status. Historical reads remain server-side. Raw telemetry is not subscribed broadly through Realtime.

## 10.9 Events

- `device.provisioned`
- `device.online` / `device.offline`
- `sensor.stale`
- `sensor.quality_failed`
- `calibration.due` / `calibration.failed`
- `telemetry.target_deviation`
- `controller.recipe_changed`
- `control.command_requested`
- `control.command_confirmed` / `control.command_failed`

## 10.10 KPIs

Sensor uptime, missing intervals, calibration compliance, data-quality score, time in target band, environmental exposure duration, gateway buffer depth, telemetry latency, device fault recurrence and command success/rollback.

## 10.11 Module acceptance gate

- Device data can be buffered during a prolonged outage and replayed without duplicates.
- Sensor stale/disagreement conditions are detected and display quality clearly.
- Existing local controls and alarms continue when cloud and internet are unavailable.
- No command is enabled until read-only monitoring, role controls, bounds, confirmation, rollback and hazard acceptance are proven.

---

---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 992-1106)*
