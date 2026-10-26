# Schlüsselbrett

A small PWA for our shared flat (WG) car: reserve the car with two taps and always see who has it when.

- Closed group: Google sign-in, admin approval, then passkeys (Face ID)
- Overlapping bookings become requests the first booker can resolve
- Works offline (read cache + outbox), Web Push notifications, iCal feed
- Runs entirely on the Cloudflare free plan (Workers, D1, R2)

Status: just getting started.
