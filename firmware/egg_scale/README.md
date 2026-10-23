# Egg scale firmware setup

This sketch uses the SparkFun Qwiic Scale NAU7802 library and the 3018.23 calibration factor measured for this load cell. It tares at startup, waits for a stable egg weight, sends one reading, then waits for the platform to be empty before it accepts another egg.

## Firmware configuration

1. Copy `secrets.example.h` to `secrets.h` in this folder.
2. Set the 2.4 GHz Wi-Fi name and password, your deployed Vercel URL, and the same device token configured on Vercel.
3. Open `egg_scale.ino` in Arduino IDE. Select the same ESP32-S3 board and port you used for the SparkFun examples, then upload.
4. Open Serial Monitor at **115200 baud**. Keep the platform empty during startup so the sketch can tare it. It reports when it is ready.

The ESP32 core's built-in CA bundle validates the HTTPS connection. The sketch does not disable TLS certificate checks.

## Supabase setup

Run `database/create-scale-readings.sql` in the Supabase SQL Editor. It creates a table where the server can store scale readings and lets each signed-in account read only its own rows.

Find the UUID of the Supabase Auth account used by the phone app in **Authentication → Users**. This account owns the readings. If another person uses a separate login, that account will need to be added to the access policy before it can receive scale readings.

## Private configuration values

Generate a 64-character token in PowerShell:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
-join ($bytes | ForEach-Object { $_.ToString('x2') })
```

Set these variables in Vercel for the deployed environment, and in `.env.local` for local development:

| Variable | Value |
| --- | --- |
| `SCALE_DEVICE_TOKEN` | The generated token |
| `SCALE_OWNER_USER_ID` | The Supabase Auth UUID for the account receiving the readings |
| `SUPABASE_SECRET_KEY` | A Supabase secret API key; keep it server-side |

Put the same generated token in the local `secrets.h`. Set `SCALE_API_URL` there to `https://your-deployed-domain/api/scale/reading`.

The existing `NEXT_PUBLIC_SUPABASE_URL` setting is used by the server route too. The publishable key remains in the browser; the secret key must never use a `NEXT_PUBLIC_` name or be added to firmware.

## Using the scale

Start a collection on the phone while signed in to the account configured as `SCALE_OWNER_USER_ID`. Place one egg on the empty platform. After its weight stabilizes, the sketch sends it to the app and the app rounds it to the nearest gram in the weight field. Select the flock and color, then save the egg as usual. Remove the egg and wait for the scale to report that it is ready before weighing the next one.

If you change the load cell, mounting, or scale platform, verify the calibration again. The weight field currently stores whole grams, so the phone rounds the reading to the nearest gram.
