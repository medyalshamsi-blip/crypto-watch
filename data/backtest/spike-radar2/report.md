# Volume-spike radar replay (15m, Binance USDT spot)

Run 2026-11-28T17:24Z. Paper only, not financial advice. Rules: engine/spike-radar2.config.json. Data window: 2026-02-15 to 2026-11-28 (events from 2026-05-01; the earlier weeks only build the baselines). Times are Berlin time in the CSV files.

## Read this first

- Coins: 133 downloaded (9 of the 9 named ones). "named" = your nine; "all" = the nine plus the wider liquid USDT universe.
- Outcomes are scored from the alert close: O1 next 15m close > +5%, O2 next candle high > +5%, O3 any of the next four closes > +5%. Pending = not observable yet (end of data or a missing candle). O1 and O2 sit inside O3.
- "By chance" is the share of ordinary candles of the same coin and session that reach the same outcome; lift = hit rate / by chance. A hit rate only means something relative to that.
- "as written" is the setup exactly as you wrote it. The "cleaned" variant and the sensitivity variants are in the last section.

## As written: Your nine coins (9 coins)

| Stage | Events | O1 next close | O2 next high | O3 any of 4 closes | O3 95% interval | O3 by chance (lift) |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 36575 | 113/36574 = 0.3% | 267/36574 = 0.7% | 786/36570 = 2.1% | 2.0%-2.3% | 0.77% (x2.8) |
| Watch, not Late spike | 36441 | 101/36440 = 0.3% | 233/36440 = 0.6% | 745/36436 = 2.0% | 1.9%-2.2% | 0.77% (x2.7) |
| Watch, Late spike | 134 | 12/134 = 9.0% | 34/134 = 25.4% | 41/134 = 30.6% | 23.4%-38.8% | 1.30% (x23.5) |
| Priority | 5059 | 26/5057 = 0.5% | 76/5057 = 1.5% | 131/5057 = 2.6% | 2.2%-3.1% | 0.75% (x3.4) |
| Priority on the Watch candle | 4234 | 25/4234 = 0.6% | 74/4234 = 1.7% | 128/4234 = 3.0% | 2.5%-3.6% | 0.77% (x3.9) |
| Priority on a later close | 825 | 1/823 = 0.1% | 2/823 = 0.2% | 3/823 = 0.4% | 0.1%-1.1% | 0.67% (x0.5) |
| Notification | 2473 | 17/2473 = 0.7% | 55/2473 = 2.2% | 93/2473 = 3.8% | 3.1%-4.6% | 0.78% (x4.8) |
| Same candle but 1H filter failed | 1761 | 8/1761 = 0.5% | 19/1761 = 1.1% | 35/1761 = 2.0% | 1.4%-2.8% | 0.75% (x2.6) |
| Retest | 1199 | 4/1199 = 0.3% | 8/1199 = 0.7% | 14/1199 = 1.2% | 0.7%-2.0% | 0.72% (x1.6) |
| Fade | 1599 | 2/1599 = 0.1% | 5/1599 = 0.3% | 32/1599 = 2.0% | 1.4%-2.8% | 0.72% (x2.8) |
| Retest after a Notification | 509 | 2/509 = 0.4% | 5/509 = 1.0% | 6/509 = 1.2% | 0.5%-2.5% | 0.71% (x1.7) |
| Fade after a Notification | 719 | 1/719 = 0.1% | 4/719 = 0.6% | 24/719 = 3.3% | 2.3%-4.9% | 0.75% (x4.4) |

Most active coins by Watch count: INIT 6212, ORCA 4982, KERNEL 4824, MUBARAK 4693, ZEC 3727, ENA 3302, ETHFI 3047, ORDI 2917.

### Without MUBARAK and INIT (the coins with the most hits)

| Stage | Events | O1 next close | O2 next high | O3 any of 4 closes | O3 95% interval | O3 by chance (lift) |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 25670 | 41/25669 = 0.2% | 108/25669 = 0.4% | 384/25665 = 1.5% | 1.4%-1.7% | 0.47% (x3.2) |
| Priority | 3651 | 11/3649 = 0.3% | 31/3649 = 0.8% | 60/3649 = 1.6% | 1.3%-2.1% | 0.45% (x3.6) |
| Notification | 1773 | 9/1773 = 0.5% | 25/1773 = 1.4% | 45/1773 = 2.5% | 1.9%-3.4% | 0.47% (x5.4) |
| Retest | 879 | 2/879 = 0.2% | 3/879 = 0.3% | 4/879 = 0.5% | 0.2%-1.2% | 0.44% (x1.0) |
| Fade | 1172 | 0/1172 = 0.0% | 1/1172 = 0.1% | 18/1172 = 1.5% | 1.0%-2.4% | 0.43% (x3.6) |

### Direction check: does it point up, or only say "something is moving"?

| Stage | Events | Up O3 (+5% any of 4 closes) | Up by chance | Down D3 (-5% any of 4 closes) | Down by chance | Up from the next open N3 |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 36575 | 786/36570 = 2.1% | 0.77% (x2.8) | 563/36570 = 1.5% | 0.52% (x3.0) | 792/36570 = 2.2% |
| Watch, Late spike | 134 | 41/134 = 30.6% | 1.30% (x23.5) | 32/134 = 23.9% | 0.88% (x27.3) | 40/134 = 29.9% |
| Priority | 5059 | 131/5057 = 2.6% | 0.75% (x3.4) | 101/5057 = 2.0% | 0.52% (x3.8) | 129/5057 = 2.6% |
| Notification | 2473 | 93/2473 = 3.8% | 0.78% (x4.8) | 66/2473 = 2.7% | 0.52% (x5.2) | 91/2473 = 3.7% |
| Same candle but 1H filter failed | 1761 | 35/1761 = 2.0% | 0.75% (x2.6) | 30/1761 = 1.7% | 0.54% (x3.2) | 35/1761 = 2.0% |
| Retest | 1199 | 14/1199 = 1.2% | 0.72% (x1.6) | 27/1199 = 2.3% | 0.51% (x4.4) | 14/1199 = 1.2% |
| Fade | 1599 | 32/1599 = 2.0% | 0.72% (x2.8) | 16/1599 = 1.0% | 0.51% (x2.0) | 32/1599 = 2.0% |

### Without the 2 most active coins (INIT, ORCA)

| Stage | Events | O1 next close | O2 next high | O3 any of 4 closes | O3 95% interval | O3 by chance (lift) |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 25381 | 53/25380 = 0.2% | 132/25380 = 0.5% | 483/25377 = 1.9% | 1.7%-2.1% | 0.62% (x3.1) |
| Priority | 3744 | 9/3743 = 0.2% | 31/3743 = 0.8% | 86/3743 = 2.3% | 1.9%-2.8% | 0.60% (x3.8) |
| Notification | 1847 | 8/1847 = 0.4% | 27/1847 = 1.5% | 67/1847 = 3.6% | 2.9%-4.6% | 0.64% (x5.6) |
| Retest | 895 | 2/895 = 0.2% | 4/895 = 0.4% | 7/895 = 0.8% | 0.4%-1.6% | 0.56% (x1.4) |
| Fade | 1191 | 0/1191 = 0.0% | 0/1191 = 0.0% | 23/1191 = 1.9% | 1.3%-2.9% | 0.57% (x3.4) |

### Without the 3 most active coins (INIT, ORCA, KERNEL)

| Stage | Events | O1 next close | O2 next high | O3 any of 4 closes | O3 95% interval | O3 by chance (lift) |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 20557 | 44/20556 = 0.2% | 103/20556 = 0.5% | 422/20553 = 2.1% | 1.9%-2.3% | 0.66% (x3.1) |
| Priority | 3201 | 7/3200 = 0.2% | 24/3200 = 0.8% | 77/3200 = 2.4% | 1.9%-3.0% | 0.63% (x3.8) |
| Notification | 1620 | 7/1620 = 0.4% | 23/1620 = 1.4% | 61/1620 = 3.8% | 2.9%-4.8% | 0.67% (x5.6) |
| Retest | 770 | 0/770 = 0.0% | 2/770 = 0.3% | 5/770 = 0.6% | 0.3%-1.5% | 0.58% (x1.1) |
| Fade | 976 | 0/976 = 0.0% | 0/976 = 0.0% | 20/976 = 2.0% | 1.3%-3.1% | 0.61% (x3.4) |

## As written: All coins downloaded (133 coins)

| Stage | Events | O1 next close | O2 next high | O3 any of 4 closes | O3 95% interval | O3 by chance (lift) |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 496010 | 1572/495974 = 0.3% | 3774/495974 = 0.8% | 9582/495882 = 1.9% | 1.9%-2.0% | 0.64% (x3.0) |
| Watch, not Late spike | 494190 | 1363/494154 = 0.3% | 3266/494154 = 0.7% | 9066/494063 = 1.8% | 1.8%-1.9% | 0.64% (x2.9) |
| Watch, Late spike | 1820 | 209/1820 = 11.5% | 508/1820 = 27.9% | 516/1819 = 28.4% | 26.3%-30.5% | 1.69% (x16.8) |
| Priority | 68539 | 341/68534 = 0.5% | 820/68534 = 1.2% | 1558/68527 = 2.3% | 2.2%-2.4% | 0.56% (x4.1) |
| Priority on the Watch candle | 55755 | 335/55752 = 0.6% | 807/55752 = 1.4% | 1511/55745 = 2.7% | 2.6%-2.8% | 0.57% (x4.7) |
| Priority on a later close | 12784 | 6/12782 = 0.0% | 13/12782 = 0.1% | 47/12782 = 0.4% | 0.3%-0.5% | 0.51% (x0.7) |
| Notification | 31952 | 241/31949 = 0.8% | 581/31949 = 1.8% | 1074/31945 = 3.4% | 3.2%-3.6% | 0.57% (x5.9) |
| Same candle but 1H filter failed | 23803 | 94/23803 = 0.4% | 226/23803 = 0.9% | 437/23800 = 1.8% | 1.7%-2.0% | 0.57% (x3.2) |
| Retest | 16916 | 43/16914 = 0.3% | 110/16914 = 0.7% | 291/16912 = 1.7% | 1.5%-1.9% | 0.56% (x3.1) |
| Fade | 22262 | 41/22262 = 0.2% | 86/22262 = 0.4% | 271/22261 = 1.2% | 1.1%-1.4% | 0.57% (x2.1) |
| Retest after a Notification | 7156 | 26/7154 = 0.4% | 68/7154 = 1.0% | 185/7153 = 2.6% | 2.2%-3.0% | 0.58% (x4.4) |
| Fade after a Notification | 9216 | 27/9216 = 0.3% | 57/9216 = 0.6% | 173/9216 = 1.9% | 1.6%-2.2% | 0.58% (x3.2) |

Most active coins by Watch count: GTC 7257, MOVE 6730, SOPH 6353, ONE 6343, COOKIE 6251, INIT 6212, BMT 6151, AVA 6022.

### Without MUBARAK and INIT (the coins with the most hits)

| Stage | Events | O1 next close | O2 next high | O3 any of 4 closes | O3 95% interval | O3 by chance (lift) |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 485105 | 1500/485069 = 0.3% | 3615/485069 = 0.7% | 9180/484977 = 1.9% | 1.9%-1.9% | 0.63% (x3.0) |
| Priority | 67131 | 326/67126 = 0.5% | 775/67126 = 1.2% | 1487/67119 = 2.2% | 2.1%-2.3% | 0.54% (x4.1) |
| Notification | 31252 | 233/31249 = 0.7% | 551/31249 = 1.8% | 1026/31245 = 3.3% | 3.1%-3.5% | 0.55% (x6.0) |
| Retest | 16596 | 41/16594 = 0.2% | 105/16594 = 0.6% | 281/16592 = 1.7% | 1.5%-1.9% | 0.54% (x3.1) |
| Fade | 21835 | 39/21835 = 0.2% | 82/21835 = 0.4% | 257/21834 = 1.2% | 1.0%-1.3% | 0.56% (x2.1) |

### Direction check: does it point up, or only say "something is moving"?

| Stage | Events | Up O3 (+5% any of 4 closes) | Up by chance | Down D3 (-5% any of 4 closes) | Down by chance | Up from the next open N3 |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 496010 | 9582/495882 = 1.9% | 0.64% (x3.0) | 7458/495883 = 1.5% | 0.48% (x3.1) | 9575/495882 = 1.9% |
| Watch, Late spike | 1820 | 516/1819 = 28.4% | 1.69% (x16.8) | 621/1820 = 34.1% | 1.18% (x28.8) | 513/1819 = 28.2% |
| Priority | 68539 | 1558/68527 = 2.3% | 0.56% (x4.1) | 1158/68528 = 1.7% | 0.42% (x4.0) | 1556/68527 = 2.3% |
| Notification | 31952 | 1074/31945 = 3.4% | 0.57% (x5.9) | 853/31946 = 2.7% | 0.42% (x6.3) | 1071/31945 = 3.4% |
| Same candle but 1H filter failed | 23803 | 437/23800 = 1.8% | 0.57% (x3.2) | 279/23800 = 1.2% | 0.43% (x2.7) | 439/23800 = 1.8% |
| Retest | 16916 | 291/16912 = 1.7% | 0.56% (x3.1) | 251/16912 = 1.5% | 0.42% (x3.5) | 288/16912 = 1.7% |
| Fade | 22262 | 271/22261 = 1.2% | 0.57% (x2.1) | 218/22261 = 1.0% | 0.44% (x2.2) | 263/22261 = 1.2% |

### Without the 2 most active coins (GTC, MOVE)

| Stage | Events | O1 next close | O2 next high | O3 any of 4 closes | O3 95% interval | O3 by chance (lift) |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 482023 | 1517/481988 = 0.3% | 3621/481988 = 0.8% | 9252/481899 = 1.9% | 1.9%-2.0% | 0.63% (x3.0) |
| Priority | 67574 | 329/67569 = 0.5% | 790/67569 = 1.2% | 1519/67563 = 2.2% | 2.1%-2.4% | 0.55% (x4.1) |
| Notification | 31516 | 230/31513 = 0.7% | 556/31513 = 1.8% | 1044/31510 = 3.3% | 3.1%-3.5% | 0.56% (x5.9) |
| Retest | 16664 | 43/16662 = 0.3% | 108/16662 = 0.6% | 281/16660 = 1.7% | 1.5%-1.9% | 0.55% (x3.1) |
| Fade | 21901 | 39/21901 = 0.2% | 83/21901 = 0.4% | 261/21900 = 1.2% | 1.1%-1.3% | 0.57% (x2.1) |

### Without the 3 most active coins (GTC, MOVE, SOPH)

| Stage | Events | O1 next close | O2 next high | O3 any of 4 closes | O3 95% interval | O3 by chance (lift) |
|:---|---:|---:|---:|---:|---:|---:|
| Watch | 475670 | 1468/475635 = 0.3% | 3504/475635 = 0.7% | 9005/475546 = 1.9% | 1.9%-1.9% | 0.62% (x3.0) |
| Priority | 66978 | 323/66973 = 0.5% | 775/66973 = 1.2% | 1484/66967 = 2.2% | 2.1%-2.3% | 0.54% (x4.1) |
| Notification | 31253 | 227/31250 = 0.7% | 546/31250 = 1.7% | 1020/31247 = 3.3% | 3.1%-3.5% | 0.55% (x5.9) |
| Retest | 16540 | 42/16538 = 0.3% | 104/16538 = 0.6% | 277/16536 = 1.7% | 1.5%-1.9% | 0.54% (x3.1) |
| Fade | 21662 | 37/21662 = 0.2% | 77/21662 = 0.4% | 255/21661 = 1.2% | 1.0%-1.3% | 0.55% (x2.1) |

## By coin (as written, your nine)

| Coin | Watch | Watch O3 | Priority | Priority O3 | Notification | Notification O3 | Retest | Fade |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|
| ETHFI | 3047 | 30/3046 = 1.0% | 528 | 3/528 = 0.6% | 259 | 2/259 = 0.8% | 130 | 172 |
| ENA | 3302 | 73/3302 = 2.2% | 520 | 11/520 = 2.1% | 262 | 6/262 = 2.3% | 135 | 160 |
| FET | 2871 | 11/2870 = 0.4% | 521 | 0/521 = 0.0% | 259 | 0/259 = 0.0% | 129 | 146 |
| ZEC | 3727 | 71/3727 = 1.9% | 493 | 12/493 = 2.4% | 249 | 10/249 = 4.0% | 123 | 138 |
| ORDI | 2917 | 37/2915 = 1.3% | 530 | 11/529 = 2.1% | 268 | 10/268 = 3.7% | 118 | 176 |
| MUBARAK | 4693 | 200/4693 = 4.3% | 609 | 40/609 = 6.6% | 323 | 33/323 = 10.2% | 135 | 184 |
| INIT | 6212 | 202/6212 = 3.3% | 799 | 31/799 = 3.9% | 377 | 15/377 = 4.0% | 185 | 243 |
| ORCA | 4982 | 101/4981 = 2.0% | 516 | 14/515 = 2.7% | 249 | 11/249 = 4.4% | 119 | 165 |
| KERNEL | 4824 | 61/4824 = 1.3% | 543 | 9/543 = 1.7% | 227 | 6/227 = 2.6% | 125 | 215 |

## By session (as written, your nine)

| Session | Watch | Watch O3 | Priority | Priority O3 | Notification | Notification O3 | Retest | Fade |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|
| TYO | 6211 | 105/6211 = 1.7% | 953 | 14/953 = 1.5% | 375 | 5/375 = 1.3% | 231 | 300 |
| LON | 6653 | 178/6653 = 2.7% | 1078 | 31/1078 = 2.9% | 551 | 24/551 = 4.4% | 264 | 326 |
| NY | 4372 | 114/4372 = 2.6% | 564 | 17/564 = 3.0% | 298 | 14/298 = 4.7% | 125 | 187 |
| LON-NY | 1766 | 80/1766 = 4.5% | 340 | 18/340 = 5.3% | 178 | 16/178 = 9.0% | 71 | 99 |
| OFF-WKDY | 4826 | 60/4821 = 1.2% | 547 | 6/545 = 1.1% | 288 | 3/288 = 1.0% | 143 | 167 |
| OFF-WKND | 12747 | 249/12747 = 2.0% | 1577 | 45/1577 = 2.9% | 783 | 31/783 = 4.0% | 365 | 520 |

| Hour of a session | Watch | Watch O3 | Priority | Priority O3 | Notification | Notification O3 |
|:---|---:|---:|---:|---:|---:|---:|
| first hour of a session | 2796 | 83/2796 = 3.0% | 509 | 10/509 = 2.0% | 224 | 7/224 = 3.1% |
| last hour of a session | 2855 | 71/2855 = 2.5% | 409 | 17/409 = 4.2% | 207 | 14/207 = 6.8% |
| neither | 30924 | 632/30919 = 2.0% | 4141 | 104/4139 = 2.5% | 2042 | 72/2042 = 3.5% |

## By session (as written, all coins)

| Session | Watch | Watch O3 | Priority | Priority O3 | Notification | Notification O3 | Retest | Fade |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|
| TYO | 87674 | 1686/87674 = 1.9% | 13572 | 248/13572 = 1.8% | 5081 | 144/5081 = 2.8% | 3390 | 4683 |
| LON | 93094 | 2068/93094 = 2.2% | 14923 | 344/14923 = 2.3% | 7158 | 239/7158 = 3.3% | 3742 | 4630 |
| NY | 60887 | 1170/60887 = 1.9% | 7715 | 198/7715 = 2.6% | 3625 | 142/3625 = 3.9% | 2008 | 2650 |
| LON-NY | 25419 | 713/25419 = 2.8% | 4329 | 132/4329 = 3.0% | 2272 | 99/2272 = 4.4% | 994 | 1414 |
| OFF-WKDY | 67629 | 845/67501 = 1.3% | 7710 | 113/7698 = 1.5% | 3940 | 82/3933 = 2.1% | 2019 | 2447 |
| OFF-WKND | 161307 | 3100/161307 = 1.9% | 20290 | 523/20290 = 2.6% | 9876 | 368/9876 = 3.7% | 4763 | 6438 |

| Hour of a session | Watch | Watch O3 | Priority | Priority O3 | Notification | Notification O3 |
|:---|---:|---:|---:|---:|---:|---:|
| first hour of a session | 40056 | 929/40056 = 2.3% | 6711 | 127/6711 = 1.9% | 2858 | 89/2858 = 3.1% |
| last hour of a session | 39995 | 823/39995 = 2.1% | 5539 | 161/5539 = 2.9% | 2640 | 116/2640 = 4.4% |
| neither | 415959 | 7830/415831 = 1.9% | 56289 | 1270/56277 = 2.3% | 26454 | 869/26447 = 3.3% |

## Stability across time and baseline size (as written, all coins)

| Block | Watch | Watch O3 | Priority | Priority O3 | Notification | Notification O3 |
|:---|---:|---:|---:|---:|---:|---:|
| first block (before the split) | 288517 | 5512/288517 = 1.9% | 39576 | 859/39576 = 2.2% | 18667 | 586/18667 = 3.1% |
| second block (after the split) | 207493 | 4070/207365 = 2.0% | 28963 | 699/28951 = 2.4% | 13285 | 488/13278 = 3.7% |

| Watch candles by baseline | Events | O3 hits |
|:---|---:|---:|
| baseline < 10k USDT | 351123 | 7781/351003 = 2.2% |
| baseline 10k to 50k USDT | 99122 | 1365/99115 = 1.4% |
| baseline 50k to 250k USDT | 34257 | 349/34256 = 1.0% |
| baseline >= 250k USDT | 11508 | 87/11508 = 0.8% |

## Priority follow-through (one pending Priority per coin)

| Set | Tracked Priorities | Retest | Fade | Expired (4 closes, neither) |
|:---|---:|---:|---:|---:|
| your nine | 4087 | 1199 (29.3%) | 1599 (39.1%) | 1287 (31.5%) |
| all coins | 56369 | 16916 (30.0%) | 22262 (39.5%) | 17183 (30.5%) |

## Data checks

Taker-buy quote volume (kline field 10) as a share of quote volume (field 7): median coin 49.6%, range 42.6% to 52.9%. Share of candles that are a Watch (3x or more), your nine: ETHFI 15%, ENA 16%, FET 14%, ZEC 18%, ORDI 14%, MUBARAK 23%, INIT 31%, ORCA 25%, KERNEL 24%.

| Session | Candles | No usable baseline |
|:---|---:|---:|
| TYO | 473720 | 4914 (1.0%) |
| LON | 502496 | 8942 (1.8%) |
| NY | 339938 | 5361 (1.6%) |
| LON-NY | 152672 | 4094 (2.7%) |
| OFF-WKDY | 417928 | 72954 (17.5%) |
| OFF-WKND | 749568 | 19375 (2.6%) |

Look-ahead slip: of the Watch+Priority same-candle events, 5.3% get a different 1H verdict when the 1H bar that ends exactly at the event close is not allowed (as written lets it in whenever the event candle is the last quarter of an hour).

Coins that could not be used: none.

## Variants and sensitivity

| Variant | Watch (all) | Priority (all) | Notification (all) | Notification O1/O2/O3 (all) | O3 vs chance | Notification (nine) | Notification O3 (nine) |
|:---|---:|---:|---:|---:|---:|---:|---:|
| as written | 496010 | 68539 | 31952 | 241/31949 = 0.8%; 581/31949 = 1.8%; 1074/31945 = 3.4% | 0.57% (x5.9) | 2473 | 93/2473 = 3.8% |
| cleaned | 62476 | 18241 | 6903 | 12/6903 = 0.2%; 32/6903 = 0.5%; 125/6903 = 1.8% | 0.32% (x5.6) | 561 | 18/561 = 3.2% |
| no 1H filter | 496010 | 68539 | 55755 | 335/55752 = 0.6%; 807/55752 = 1.4%; 1511/55745 = 2.7% | 0.57% (x4.7) | 4234 | 128/4234 = 3.0% |
| 1H bar before the candle opens | 496010 | 68539 | 28995 | 230/28994 = 0.8%; 540/28994 = 1.9%; 991/28990 = 3.4% | 0.57% (x6.0) | 2253 | 88/2253 = 3.9% |
| Watch 2x | 713372 | 88681 | 39987 | 243/39981 = 0.6%; 585/39981 = 1.5%; 1111/39977 = 2.8% | 0.55% (x5.1) | 3045 | 97/3044 = 3.2% |
| Watch 5x | 302955 | 45911 | 22601 | 229/22599 = 1.0%; 561/22599 = 2.5%; 991/22595 = 4.4% | 0.62% (x7.1) | 1793 | 85/1793 = 4.7% |
| RSI 40 | 496010 | 68539 | 36257 | 255/36254 = 0.7%; 621/36254 = 1.7%; 1142/36250 = 3.2% | 0.57% (x5.5) | 2738 | 96/2738 = 3.5% |
| Priority lookback 4 | 496010 | 86081 | 37173 | 263/37170 = 0.7%; 647/37170 = 1.7%; 1198/37166 = 3.2% | 0.58% (x5.6) | 2914 | 107/2914 = 3.7% |
| close in top 20% | 496010 | 50328 | 22229 | 170/22228 = 0.8%; 412/22228 = 1.9%; 748/22225 = 3.4% | 0.57% (x5.9) | 1695 | 71/1695 = 4.2% |
| baseline 10 slots | 489842 | 70093 | 32043 | 241/32039 = 0.8%; 578/32039 = 1.8%; 1071/32035 = 3.3% | 0.57% (x5.8) | 2432 | 90/2431 = 3.7% |

"cleaned" = Watch and Priority events within 4 candles of the previous one dropped, baseline at least 10,000 USDT, Late-spike candles cannot notify, 1H bar must be closed before the event candle opens. To try other settings edit spike-radar2.config.json (variants list) and push.
