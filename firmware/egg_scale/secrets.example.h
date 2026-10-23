#pragma once

// Copy this file to secrets.h and replace each value. secrets.h is gitignored.
#define WIFI_SSID "YOUR_2_4_GHZ_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Use the same long random token in SCALE_DEVICE_TOKEN on Vercel.
#define SCALE_DEVICE_TOKEN "REPLACE_WITH_A_RANDOM_64_CHARACTER_HEX_TOKEN"

// Your deployed Vercel domain, followed by this exact path.
#define SCALE_API_URL "https://YOUR-APP.vercel.app/api/scale/reading"
