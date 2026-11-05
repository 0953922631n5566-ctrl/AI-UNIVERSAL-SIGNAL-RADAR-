#!/usr/bin/env python3
"""Decode available Dukascopy BI5 files, retain gaps and enforce coverage."""
import argparse,csv,datetime as dt,json,lzma,os,struct,sys
from pathlib import Path
RECORD=20
def weekday_hours(a,b):
 n=0;d=a
 while d<=b:
  if d.weekday()<5:n+=24
  d+=dt.timedelta(days=1)
 return n
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--raw-dir",default="data/historical/raw/EURUSD")
 p.add_argument("--ticks-out",default="data/historical/EURUSD_ticks.csv")
 p.add_argument("--m1-out",default="data/historical/EURUSD_M1.csv")
 p.add_argument("--manifest",default="data/historical/download-manifest.json")
 p.add_argument("--min-coverage-pct",type=float,default=float(os.getenv("HISTORICAL_MIN_COVERAGE_PCT","50")))
 p.add_argument("--min-ticks",type=int,default=int(os.getenv("HISTORICAL_MIN_TICKS","100")))
 p.add_argument("--min-m1-candles",type=int,default=int(os.getenv("HISTORICAL_MIN_M1_CANDLES","202")))
 a=p.parse_args();files=sorted(Path(a.raw_dir).glob("*/*/*/*h_ticks.bi5"))
 if not files:raise SystemExit("No BI5 files found")
 mp=Path(a.manifest);manifest=json.loads(mp.read_text()) if mp.exists() else {}
 tp,cp=Path(a.ticks_out),Path(a.m1_out);tp.parent.mkdir(parents=True,exist_ok=True);cp.parent.mkdir(parents=True,exist_ok=True)
 ticks=0;valid=0;bad=[];minutes={}
 with tp.open("w",newline="",encoding="utf-8") as tf:
  w=csv.writer(tf);w.writerow(["timestamp","bid","ask"])
  for f in files:
   try:
    y,mo,d=map(int,f.parts[-4:-1]);h=int(f.name[:2]);start=dt.datetime(y,mo+1,d,h,tzinfo=dt.timezone.utc)
    raw=lzma.decompress(f.read_bytes(),format=lzma.FORMAT_ALONE)
    if not raw or len(raw)%RECORD:raise ValueError("invalid BI5 record length")
    prev=-1;rows=[];bars={}
    for off in range(0,len(raw),RECORD):
     ms,ask_i,bid_i,av,bv=struct.unpack_from(">IIIff",raw,off)
     if ms<prev or ask_i<=0 or bid_i<=0 or ask_i<bid_i:raise ValueError("invalid/non-monotonic quote at byte "+str(off))
     prev=ms;ts=start+dt.timedelta(milliseconds=ms);ask=ask_i/100000;bid=bid_i/100000
     rows.append([ts.isoformat().replace("+00:00","Z"),"%.5f"%bid,"%.5f"%ask])
     minute=ts.replace(second=0,microsecond=0)
     if minute not in bars:bars[minute]=[bid,bid,bid,bid,0.0]
     b=bars[minute];b[1]=max(b[1],bid);b[2]=min(b[2],bid);b[3]=bid;b[4]+=max(0,av)+max(0,bv)
    w.writerows(rows);minutes.update(bars);ticks+=len(rows);valid+=1
   except Exception as e:
    bad.append({"file":str(f),"reason":str(e)});print("Skipping corrupt BI5 "+str(f)+": "+str(e),file=sys.stderr)
 with cp.open("w",newline="",encoding="utf-8") as cf:
  w=csv.writer(cf);w.writerow(["time","open","high","low","close","volume"])
  for t,b in sorted(minutes.items()):w.writerow([t.isoformat().replace("+00:00","Z")]+["%.5f"%x for x in b[:4]]+["%.2f"%b[4]])
 cov=manifest.get("coverage",{});pct=float(cov.get("coveragePct",100));dr=manifest.get("dateRange") or {}
 if dr.get("from") and dr.get("to"):
  expected=weekday_hours(dt.date.fromisoformat(dr["from"]),dt.date.fromisoformat(dr["to"]));pct=round(valid/expected*100,2) if expected else 100
 report={"source":"Dukascopy public historical datafeed","instrument":"EUR/USD","generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),"dateRange":dr,"hourlyFilesFound":len(files),"validHourlyFiles":valid,"corruptHourlyFiles":bad,"tickCount":ticks,"m1CandleCount":len(minutes),"coveragePct":pct,"minimumCoveragePct":a.min_coverage_pct,"minimumTicks":a.min_ticks,"minimumM1Candles":a.min_m1_candles,"horizonsSeconds":[10,20,30],"coveragePass":pct>=a.min_coverage_pct,"dataPass":ticks>=a.min_ticks and len(minutes)>=a.min_m1_candles}
 rp=Path("data/historical/reports/decode-report.json");rp.parent.mkdir(parents=True,exist_ok=True);rp.write_text(json.dumps(report,indent=2)+"\n")
 print(json.dumps(report,indent=2))
 if not report["coveragePass"]:raise SystemExit("Coverage threshold not met; decoded files/report retained")
 if not report["dataPass"]:raise SystemExit("Insufficient tick/M1 history; decoded files/report retained")
if __name__=="__main__":main()
