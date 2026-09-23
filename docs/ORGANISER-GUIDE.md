# Organiser & Finance Guide

How to run the raffle from setup to prize handover. Sign in under the **Organisers** tab with your name (it goes in the audit log) and the password for your role.

| You can… | Organiser | Finance |
|---|:-:|:-:|
| Sell tickets, record paper sales, print books and slips | ✓ | ✓ |
| Edit prizes and general settings, run the draw | ✓ | ✓ |
| Void an **unpaid** sale | ✓ | ✓ |
| Mark tickets paid, work the Payments queue, void a paid sale | | ✓ |
| Change prices, manage collectors and payment QR codes | | ✓ |
| See money collected and outstanding, export CSV | | ✓ |

Only **paid** tickets enter the draw.

---

## First-time setup

Do this signed in as **finance**.

1. **Settings.** Set the event name, tagline, ticket prefix (e.g. `DSH`), draw date and time, and the **ticket sales close** date and time (Nepal time). Optionally set a ticket limit and a per-person limit.
2. **Settings → Ticket prices.** Set the single-ticket price (required) and any bundles, e.g. 3 for 500 and 7 for 1,000. Every sale is charged the cheapest combination, so 4 tickets = 3 + 1.
3. **Prizes.** Replace the sample prizes. **Order** 1 is the grand prize. A quantity above 1 means that many winners.
4. **Collectors.** List who can receive money:
   - **Type:** Finance, or a designated person.
   - **Methods:** the payment methods they accept.
   - **How to reach them:** e.g. `@sunita on Slack` or `#dashain-raffle`.
   - **Chat link (optional):** a Slack, Teams or `mailto:` link. It shows as a button on the buyer's receipt.
   - **QR code:** save the collector first, then upload their eSewa, Khalti or bank QR (PNG, JPG or WebP, under 2 MB).
5. **Settings → Self-service** (optional):
   - Tick **Open self-service** and set an **access code**. Share the code on the company channel, not publicly.
   - **Hold time:** how long an unpaid reservation is kept before it lapses. Default 48 hours.
   - **Most tickets in one reservation:** default 21.
6. Share the site link. Put **Draw stage** on the office screen.

## Selling tickets

**At a desk (Sell tickets):**
- Enter the buyer, team, number of tickets and who they're paying.
- Organiser sales are saved as unpaid until finance confirms. Finance can tick **Payment received** straight away.
- After issuing, you can:
  - **Copy message for buyer.** It lists their numbers and who to pay. Paste it into Slack or Teams.
  - **Print tickets.**
  - **Save ticket image.**
- If a bigger bundle costs the same or only a little more, the form suggests it ("7 tickets cost the same as 6").

**Paper ticket books (Paper tickets):**
1. **Create & print book.** This reserves a block of numbers and prints them 5 to an A4 page, each with a stub for the seller.
2. Sellers fill in the stub (name, team, phone, paid) and give the ticket to the buyer.
3. Record the sale by typing the stub numbers, e.g. `12-15, 18`, with the buyer's details. Unsold paper tickets never enter the draw.

**Self-service (Get tickets):**
1. Staff reserve tickets with the access code and choose a collector and payment method.
2. Their receipt page shows the amount, the collector's QR and a **reference** (their first ticket number) to put in the payment remarks.
3. It also shows a ready-made **"Let them know" message** to copy into Slack or Teams, plus the collector's chat button.
4. They tap **I've paid** and can add a transaction ID. The receipt updates by itself once finance confirms.
5. Unpaid reservations lapse after the hold time. Anyone who has tapped "I've paid" stays in the queue for finance.

## Confirming payments (finance)

**Organisers → Payments** lists every unpaid sale. A badge shows how many are waiting, and buyers who say they've paid are listed first.

- Filter by collector, or tick **Only buyers who say they've paid**.
- Check the money against eSewa, Khalti or bank records, or the cash handed over. Match it using the reference and the transaction ID.
- **Confirm paid** puts the tickets in the draw. **Reject** cancels the reservation, and its numbers aren't reused.
- **Sales ledger → Export CSV** gives you the full list for reconciliation.

## After sales close

- At the close date and time, every new sale is refused automatically, including self-service. Finance can still confirm payments.
- Before the draw, finish the Payments queue. Unpaid tickets can't win.

## Draw day

On **Draw stage**, organisers see controls under the reel. Everyone watching sees the same result at the same moment.

**Random pick:**
1. Choose the prize.
2. Click **Draw a winner**. The server picks a random paid ticket that hasn't already won, and the reel spins and lands on every screen.

**Physical ticket (from a bowl):**
1. Put one slip per ticket in the bowl:
   - **Print draw slips** prints one slip for every paid ticket that hasn't won yet, 40 to an A4 page.
   - Or use the stubs from the paper books. If you do, print slips for the digital and self-service tickets too, so every ticket is in the bowl exactly once.
2. Switch to **Physical ticket** and choose the prize.
3. Pull a slip and type its number, e.g. `DSH-0042` or just `42`. The page checks it straight away:
   - never sold → put it aside and draw again
   - unpaid → it can't win, draw again
   - already won → draw again
   - otherwise → the owner is shown and **Announce winner** is enabled
4. Press **Announce winner** (or Enter). The stage reveals the winner on every screen.

**Also useful:**
- **Show prizes & winners** opens the full list below the stage, in prize order.
- **Draw results** lets you remove a result so that prize can be drawn again, e.g. if the winner can't be reached.
- **Reset stage** clears a stuck screen.

The dropdown lists the smallest prize first and the grand prize last, the traditional order.

## After the draw

- Winners appear on the Live board and in **Draw results**, with full names for organisers.
- Export the CSV for finance's records.
- To reuse the site for another event, see [OPERATIONS.md → Starting a new event](OPERATIONS.md#starting-a-new-event).
