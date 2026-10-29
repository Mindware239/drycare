# Self-service laundry — machine integration

DryCare's self-service laundry module works with **ordinary machines** out of the box: staff press start on the machine and confirm in DryCare ("Mark started", "Cycle finished"). Nothing is reported as running or finished unless a person or the machine confirms it.

Smart machines, IoT relays or payment-operated controllers can be connected per machine with the **Connected controller (`http`)** mode (Laundry setup & pricing → Machines → Edit).

## Controller contract

DryCare calls the controller at the **Controller address** with the machine's **Device ID**. Requests time out after 8 seconds.

| Call | Request | Expected response |
|---|---|---|
| Start a cycle | `POST {baseUrl}/machines/{deviceId}/start` with JSON `{ "sessionId": "...", "programName": "Normal 40°", "durationMinutes": 45 }` | `2xx` with `{ "accepted": true }`. Anything else means *not started*. |
| Read status | `GET {baseUrl}/machines/{deviceId}/status` | `2xx` with `{ "state": "idle" \| "running" \| "done" \| "error", "remainingSeconds"?: number, "error"?: string }` |

If the environment variable `LAUNDRY_IOT_TOKEN` is set on the API server, every request carries `Authorization: Bearer <token>`. Keep the controller on the shop network or behind HTTPS.

## Try it without hardware: the simulator

`pnpm laundry-iot-sim` starts a simulated controller on `http://127.0.0.1:4600` that implements the contract above (cycles run 60× faster; set `LAUNDRY_SIM_SPEEDUP=1` for real time, `LAUNDRY_SIM_PORT` to change the port). In Laundry setup → Machines, choose **Connected controller**, address `http://127.0.0.1:4600` and any device ID, then book, pay and press **Start machine** on the live board. A hardware vendor can use `scripts/laundry-iot-simulator.ts` as the reference implementation. The automated test (`pnpm laundry-test`) runs the same simulator, including a mid-cycle fault.

## Safety rules enforced by DryCare

- A machine can only be started when the order is **fully paid with verified payments** (pending bank transfers do not count) and the machine is booked for that order.
- A start the controller does not accept leaves the booking in place with the error shown to staff; the machine is **never** displayed as running.
- Repeated or simultaneous start requests send at most one start command (row-level locking).
- "Check machine" asks the controller; only a `done` or `error` reported by the device changes the cycle state. Unknown or unreachable status changes nothing.
- One booked/running cycle per machine is enforced by a database unique index, so concurrent bookings cannot double-book.

## Weighing scales

"Read from scale" on the checkout screen uses the browser's Web Serial API (Chrome/Edge on Windows) and reads the first weight line a USB-serial scale sends (e.g. `4.25 kg`). Scales that only show weight on their own display are used by typing the weight. Test with your scale model before relying on it.

## Not included

No specific manufacturer protocol is built in. Adding one means writing a small adapter in `apps/api/src/lib/machineControl.ts` that implements `start` and `status`, and registering it in `ADAPTERS`.
