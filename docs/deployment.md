# Deployment

| What | Where |
|---|---|
| Frontend | Vercel |
| API | Render (service called `pick6.io`) |
| Weekly data update | Render cron job called `pick6-data-refresh` |
| Database | AWS RDS (Postgres) |

## Vercel

Settings are in `vercel.json`. The main thing to remember is the Content Security Policy. If I add images or API calls from a new website, I have to add that site to the CSP or the browser blocks it.

## Render

I set up both services by hand in the Render dashboard, so **`render.yaml` doesn't actually do anything**. Any settings changes have to be made in the dashboard.

The cron job settings:

- Build command: `pip install -r requirements.txt`
- Command: `python scripts/load_data.py --current-season`
- Schedule: `0 12 * * 2` (Tuesdays)
- Needs `DATABASE_URL` set as an environment variable

You can hit "Trigger Run" to test it without waiting for Tuesday.

## Database access

The RDS security group only lets in certain IPs. It needs:

- the Render web service's IPs
- the Render cron job's IPs (different from the web service, they're on the Connect tab)
- my own IP if I'm running the data scripts myself

If the connection **times out**, it's almost always a missing IP.

## Python stuff

- `.python-version` says 3.13.3. Render uses this. Without it, Render used 3.14 and the build broke.
- Everything in `requirements.txt` has an exact version on purpose:
  - `nfl-data-py` has to stay on 0.3.2. The next version breaks the build.
  - `pyarrow` has to be listed even though nothing imports it directly (polars needs it).

If I change `requirements.txt`, I should test it in a fresh virtualenv first, since my own setup already has extra packages installed that can hide missing ones:

```bash
python3 -m venv /tmp/testenv
/tmp/testenv/bin/pip install -r requirements.txt
```
