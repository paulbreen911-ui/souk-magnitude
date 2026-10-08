// Categories -> companies. `etf` is the benchmark for the category. Edit freely.
// Tickers can be renamed/delisted over time; missing ones are just skipped.
export const UNIVERSE = {
  water:       { etf: "PHO",  tickers: ["AWK", "WTRG", "XYL", "WMS", "PNR", "ECL", "CWCO"] },
  renewables:  { etf: "ICLN", tickers: ["NEE", "ENPH", "FSLR", "BEP", "RUN", "SEDG"] },
  gold:        { etf: "GDX",  tickers: ["NEM", "AEM", "KGC", "FNV", "WPM", "GFI"] },
  copper:      { etf: "COPX", tickers: ["FCX", "SCCO", "TECK", "HBM"] },
  oil:         { etf: "XLE",  tickers: ["XOM", "CVX", "COP", "OXY", "EOG", "SLB"] },
  natural_gas: { etf: "UNG",  tickers: ["EQT", "LNG", "AR", "CTRA"] },
  uranium:     { etf: "URA",  tickers: ["CCJ", "UEC", "NXE", "DNN"] },
  lithium:     { etf: "LIT",  tickers: ["ALB", "SQM", "LAC"] },
  agriculture: { etf: "DBA",  tickers: ["ADM", "DE", "CTVA", "MOS", "NTR"] },
};
export const allTickers = () => Object.entries(UNIVERSE).flatMap(([c, u]) => [...u.tickers, u.etf].map((t) => [t, c, t === u.etf]));
