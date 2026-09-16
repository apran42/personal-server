#!/data/data/com.termux/files/usr/bin/sh

set -u

CONFIG_FILE="$HOME/.config/myserver/healthchecks.env"

BATTERY_CRITICAL_TEMPERATURE="${BATTERY_CRITICAL_TEMPERATURE:-45}"
BATTERY_LOW_PERCENT="${BATTERY_LOW_PERCENT:-15}"
WIFI_MINIMUM_RSSI="${WIFI_MINIMUM_RSSI:--80}"

if [ ! -r "$CONFIG_FILE" ]; then
    echo "Healthchecks configuration not found."
    exit 1
fi

. "$CONFIG_FILE"

if [ -z "${DEVICE_PING_URL:-}" ]; then
    echo "DEVICE_PING_URL is not configured."
    exit 1
fi

send_ping() {
    PING_TARGET="$1"

    curl \
        --fail \
        --silent \
        --show-error \
        --max-time 10 \
        --retry 3 \
        --output /dev/null \
        "$PING_TARGET"
}

check_device_status() {
    BATTERY_CRITICAL_TEMPERATURE="$BATTERY_CRITICAL_TEMPERATURE" \
        BATTERY_LOW_PERCENT="$BATTERY_LOW_PERCENT" \
        WIFI_MINIMUM_RSSI="$WIFI_MINIMUM_RSSI" \
        node <<'NODE'
const { execFileSync } = require("child_process");

function runTermuxApi(command) {
    const output = execFileSync(command, [], {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 64 * 1024
    });

    return JSON.parse(output);
}

function readNumber(name, fallback) {
    const value = Number(process.env[name]);

    return Number.isFinite(value) ? value : fallback;
}

try {
    const battery = runTermuxApi("termux-battery-status");
    const wifi = runTermuxApi("termux-wifi-connectioninfo");

    const criticalTemperature = readNumber(
        "BATTERY_CRITICAL_TEMPERATURE",
        45
    );

    const lowPercent = readNumber("BATTERY_LOW_PERCENT", 15);
    const minimumRssi = readNumber("WIFI_MINIMUM_RSSI", -80);

    const percentage = Number(battery.percentage);
    const temperature = Number(battery.temperature);
    const rssi = Number(wifi.rssi);

    const problems = [];

    if (
        Number.isFinite(temperature) &&
        temperature >= criticalTemperature
    ) {
        problems.push(
            `battery temperature ${temperature.toFixed(1)}C`
        );
    }

    if (
        battery.health &&
        !["GOOD", "UNKNOWN"].includes(battery.health)
    ) {
        problems.push(`battery health ${battery.health}`);
    }

    if (
        Number.isFinite(percentage) &&
        percentage <= lowPercent &&
        !["CHARGING", "FULL"].includes(battery.status)
    ) {
        problems.push(
            `battery ${percentage}% while ${battery.status}`
        );
    }

    if (wifi.supplicant_state !== "COMPLETED") {
        problems.push(
            `Wi-Fi state ${wifi.supplicant_state || "UNKNOWN"}`
        );
    }

    if (Number.isFinite(rssi) && rssi < minimumRssi) {
        problems.push(`Wi-Fi signal ${rssi} dBm`);
    }

    console.log(
        `Battery: ${percentage}% / ` +
        `${temperature.toFixed(1)}C / ${battery.status}`
    );

    console.log(
        `Wi-Fi: ${wifi.supplicant_state} / ` +
        `${rssi} dBm / ${wifi.link_speed_mbps} Mbps`
    );

    if (problems.length > 0) {
        console.error(`Device warning: ${problems.join(", ")}`);
        process.exit(1);
    }
} catch (error) {
    const message = String(error.message || error).split("\n")[0];

    console.error(`Device status API failed: ${message}`);
    process.exit(1);
}
NODE
}

if check_device_status; then
    send_ping "$DEVICE_PING_URL" ||
        echo "Warning: device success ping failed."

    echo "Device status healthy."
    exit 0
fi

send_ping "$DEVICE_PING_URL/fail" ||
    echo "Warning: device failure ping failed."

echo "Device status unhealthy."
exit 1
