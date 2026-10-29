# Lilizzh Studio 6.0 — secure Python backend

Your website looks and works the same, but **passwords, payment details and business rules now live on a
Python server**. The browser only ever receives what the signed-in person is allowed to see.

## What changed (and why)

| Before (in the page source) | Now |
|---|---|
| Admin passwords, editor PINs and client passwords written in the HTML | Nothing secret in any file the browser downloads. Passwords are checked on the server and stored only as scrypt hashes |
| Login "hint" showed the editor's PIN; PIN was pre-filled in the form | Removed. Wrong logins get one generic message |
| Anyone could read/edit all orders (public database) | Each person gets only their own orders; every change is validated on the server |
| Clean 4K master link sent to every browser, "locked" by a CSS overlay | Link is sent only after the admin unlocks the order |
| Bank / UPI details in the HTML | Clients get only what they need to pay: your name, UPI ID, amount and a QR code. **No bank account number, IFSC or bank name is ever sent.** Shown only to the signed-in client who owns an unpaid order |
| Your phone / e-mail printed on every page | Hidden from visitors; shown only to signed-in clients (`PUBLIC_CONTACT=1` to show to everyone) |
| Logins saved in `localStorage` | Random session cookie, `HttpOnly`, never readable by page scripts |
| Unlimited password guessing | Lock-out after repeated failures (per account and per address) |

Also added: CSRF protection, upload type/size limits, security headers (CSP, nosniff, no-framing), and
Firebase removed entirely (uploads and chat now go through your own server).

## Start it (5 minutes)

```bash
pip install -r requirements.txt
python manage.py init        # creates .env, your admin login, random editor passcodes (shown once)
python manage.py run         # http://127.0.0.1:8000
```

`init` asks for your admin e-mail and a password you choose (12+ characters). It prints each editor's
passcode **once**; give each editor theirs. Reset any time with
`python manage.py set-editor-passcode ed-1 --random`.

Want the two sample clients/orders from the original design? `python manage.py seed-demo`.

## Important: your old passwords are burned

`lilizzh@7218`, `admin123`, `password123` and the editor PINs were visible to anyone who opened the site.
Do not reuse them anywhere (the server refuses `lilizzh@7218` and `admin123` outright). If those passwords
protect any other account (e-mail, UPI app, hosting), change them now.

## Going live

1. Host somewhere with HTTPS (Render, Railway, a VPS with Caddy/nginx…).
2. In `.env`: `APP_ENV=production`, keep `SECRET_KEY`, fill `PAY_UPI_ID` / `PAY_ACCOUNT_NAME` / `CONTACT_*`, add `TRUST_PROXY=1` if behind a proxy.
3. Keep `data/` on a persistent disk and back it up (it holds the database and uploaded files).
4. Run `python manage.py check` — it lists anything still unsafe.

## Behaviour changes you may notice

* The public **rate card no longer shows "Editor Payout" and "Studio Profit"** (your margins). To show them
  again set `PUBLIC_RATE_CARD_SHOWS_MARGINS=1` in `.env`. Admin always sees them.
* Editors no longer see price-negotiation or payment messages in a project chat.
* UTR numbers can't be reused across orders; uploads accept video, audio, image, LUT, subtitle, PDF, ZIP.
* The "Direct Inquire" form now really saves the inquiry: `python manage.py inquiries`.

## Payment and contact details

```bash
python manage.py set-payment --upi yourname@okaxis --account-name "Lilesh Pravin Patil"
python manage.py set-payment --forget-bank        # deletes any old bank-account lines from .env
python manage.py set-contact --email you@gmail.com --whatsapp "+91 70200 00000"
```

* Clients pay **by UPI only**. They see your name, UPI ID, the rupee amount, a QR code and an "Open in UPI app"
  button. Bank account number, IFSC and bank name are never needed or sent. Old `PAY_ACCOUNT_NUMBER`,
  `PAY_IFSC`, `PAY_BANK_NAME` lines in `.env` are ignored.
* The QR code is now drawn by **your own server** (no third-party site sees your UPI ID or the amount).
* Contact e-mail / WhatsApp are shown **only to signed-in people**. Visitors see "Sign in to contact the studio"
  and the inquiry form. If you set neither, nobody sees any contact. `PUBLIC_CONTACT=1` makes them public.
* Use an admin **login** e-mail that is *different* from the public contact e-mail, so strangers can't guess it.
* A stranger deliberately failing logins for your account can only lock out their own address, never you.
* Restart the site after changing these.

## Private chat

In a project chat, a client can tick **"Private message to the studio owner only"**. The editor never receives
those messages (the server filters them, it is not just hidden on screen). The owner can reply privately too.
Chat is per order, so a client chats once they have placed an order.

## Admin screens (no commands needed)

Sign in as Admin and use the tabs: **Orders**, **Editors** (add, rename/edit, remove, restore, new passcode),
**Pricing** (default package prices) and **Inquiries**. A new editor's passcode is shown once. Removing an
editor hides them from clients and signs them out; you cannot remove the last active editor. The commands
below do the same things for hosts where you prefer a terminal.

## Managing editors and prices

All of these work on the live site immediately (no restart). Run `python manage.py <command> --help` for every option.

```bash
python manage.py list-editors
python manage.py add-editor --name "Jo Lee" --role-title "Podcast Editor" --tag YouTube --email jo@lilizzh.studio
python manage.py edit-editor ed-5 --name "Joanne Lee" --speed "< 20h" --bio "..."
python manage.py remove-editor ed-5        # hides them, blocks login, keeps order history
python manage.py restore-editor ed-5

python manage.py show-rates
python manage.py set-rate "Long video" --price 180 --payout 70
python manage.py set-rate rate-short --price-range "30 - 40" --turnaround "< 12h"
```

* **Hiring** = `add-editor`. It prints the new editor's passcode once; give it to them.
* Use tag `YouTube`, `Shorts`, `Documentary` or `Ads` so the editor shows under a filter button
  (any other tag appears only under "All").
* New editors show a letter avatar and the rating "New" until you set `--avatar` / `--rating`.
* `set-rate` changes the **default** prices for new orders and also saves them in `seed/rate_card.json`,
  so they survive a rebuild. Orders already placed keep their agreed price. To change one project's price,
  use the Admin dashboard. On a host where you can't run commands, use `--file-only` (or edit the JSON file)
  and redeploy.
* Editors are stored in the database (they have passcodes), so on a free host that wipes its disk they
  would need re-adding. Use a host with a persistent disk for real business.

## Editing the website

The readable source is `frontend-src/app.jsx`; the browser runs the compiled `frontend/app.js`.
After editing: `npm install && npm run build`.

## Tests

`python -m unittest discover -s tests -v` (58 tests: logins, permissions, forged fields, uploads, private chat, QR, editor / pricing / payment commands…).

## Known limits

* Login lock-outs are kept in memory, so run a single server process (fine for this site's scale).
* Amounts in rupees use `USD_TO_INR` (default 86); set it in `.env` if you want another rate.
* The page still loads Tailwind/Lucide from public CDNs; pin or self-host them for stricter control.
