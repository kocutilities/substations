# Substations & Generators

Intranet pages for the KOC Utilities E&I I team, Corporate Services Group.
Published at <https://kocutilities.github.io/substations>.

## What is here

| Page | What it does |
|---|---|
| `index.html` | Sign in. The landing page. |
| `home.html` | Overview, live counts and the way in to everything else. |
| `View_Job_Reports.html` | Every job the team has logged. |
| `View_Generator_Test_Data.html` | Monthly generator test readings. |
| `kWh_display.html` | Monthly kWh by incomer. |
| `Generator_details.html` | Nameplate data and live test-run dials. |
| `Substations_Ele_Rooms.html` | Panel boards, ratings, makes, standby sets. |
| `dashboard.html` | kWh charts, single line diagram, switchboard status. |
| `Enter_Job_Reports.html` | Record a job. |
| `Enter_Generator_Test.html` | Record a test run. |
| `kWh_Reading.html` | Record a month's meter readings. |

Every page is a static file. There is no build step: edit the HTML and push.

## Where the data comes from

Three Google Sheets, read straight from the browser with the Sheets API, and
two Apps Script web apps for the forms that write back. The sheet IDs and API
keys are in the page source, which is public - see the note below.

`Substations_Ele_Rooms.html` instead carries the substations list of
12 Sep 2026 inside the page, because it is a reference list revised
occasionally rather than live data.

## Before this goes public - read this

Anything published here is readable by anyone on the internet:

* **The data is public.** Job reports, generator serial numbers, ratings and
  consumption figures are all served to any visitor. The sign-in page is a
  front door, not a lock - it runs in the visitor's own browser and can be
  skipped by typing a page name directly.
* **The API keys are public.** Restrict each key in the Google Cloud console
  to the HTTP referrer `https://kocutilities.github.io/*` so it cannot be
  lifted and used against your quota.
* **The forms accept anonymous submissions.** The Apps Script endpoints are
  deployed to "anyone", so anyone who reads the page source can post to them.

If any of that is not acceptable, this belongs on an internal host rather
than GitHub Pages.

## Updating

1. Edit the page.
2. Commit and push to `main`.
3. GitHub Pages redeploys in about a minute.
