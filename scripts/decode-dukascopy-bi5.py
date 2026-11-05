#!/usr/bin/env python3
"""Decode Dukascopy hourly EURUSD .bi5 files into chronological Tick and M1 CSVs."""
import argparse, csv, datetime as dt, lzma, struct
from pathlib import Path
RECORD = 20
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--raw-dir", default="data/historical/raw/EURUSD")
    p.add_argument("--ticks-out", default="data/historical/EURUSD_ticks.csv")
    p.add_argument("--m1-out", default="data/historical/EURUSD_M1.csv")
    args = p.parse_args()
    files = sorted(Path(args.raw_dir).glob("*/*/*/*h_ticks.bi5"))
    if not files: raise SystemExit("No .bi5 files found; run npm run data:download first")
    tick_path, m1_path = Path(args.ticks_out), Path(args.m1_out)
    tick_path.parent.mkdir(parents=True, exist_ok=True); m1_path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with tick_path.open("w", newline="", encoding="utf-8") as tf, m1_path.open("w", newline="", encoding="utf-8") as mf:
        tw, mw = csv.writer(tf), csv.writer(mf)
        tw.writerow(["timestamp", "bid", "ask"]); mw.writerow(["time", "open", "high", "low", "close", "volume"])
        for file in files:
            year, month0, day = int(file.parts[-4]), int(file.parts[-3]), int(file.parts[-2])
            hour = int(file.name[:2])
            start = dt.datetime(year, month0 + 1, day, hour, tzinfo=dt.timezone.utc)
            blob = file.read_bytes()
            if not blob: continue
            raw = lzma.decompress(blob, format=lzma.FORMAT_ALONE)
            if len(raw) % RECORD: raise ValueError("Corrupt BI5 record length in " + str(file))
            bars = {}; previous_ms = -1
            for offset in range(0, len(raw), RECORD):
                ms, ask_i, bid_i, ask_vol, bid_vol = struct.unpack_from(">IIIff", raw, offset)
                if ms < previous_ms or ask_i <= 0 or bid_i <= 0 or ask_i < bid_i:
                    raise ValueError("Invalid/non-monotonic quote in " + str(file) + " at byte " + str(offset))
                previous_ms = ms
                timestamp = start + dt.timedelta(milliseconds=ms)
                ask, bid = ask_i / 100000.0, bid_i / 100000.0
                tw.writerow([timestamp.isoformat().replace("+00:00", "Z"), "%.5f" % bid, "%.5f" % ask])
                minute = timestamp.replace(second=0, microsecond=0)
                if minute not in bars: bars[minute] = [bid, bid, bid, bid, 0.0]
                bar = bars[minute]; bar[1] = max(bar[1], bid); bar[2] = min(bar[2], bid); bar[3] = bid
                bar[4] += max(0.0, ask_vol) + max(0.0, bid_vol); total += 1
            for minute, bar in sorted(bars.items()):
                mw.writerow([minute.isoformat().replace("+00:00", "Z")] + ["%.5f" % x for x in bar[:4]] + ["%.2f" % bar[4]])
    print("Decoded {:,} EUR/USD ticks from {:,} hourly files".format(total, len(files)))
    print("Ticks: {} | M1 bid candles: {}".format(tick_path, m1_path))
if __name__ == "__main__": main()
