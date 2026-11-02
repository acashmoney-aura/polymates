import sys, os, numpy as np
sys.path.insert(0, os.path.expanduser('~/.claude/skills/motion-film/scripts'))
from synth import *

DUR = 63.0
m = Mix(DUR)
B = 0.5  # 120 BPM

# ---------- HOOK 0 – 4.8: each question slams, odds tick up ----------
m.pad(0.0, 4.9, [45, 57, 64], 0.55, cutoff=900, attack=1.2)
for i, (t, n) in enumerate(zip([0.30, 1.10, 1.90, 2.70], [57, 60, 64, 67])):
    m.slam(t, n, 0.65 + 0.12 * i)
    for k in range(6): m.blip(t + 0.08 + k * 0.07, 900 + k * 160 + i * 120, 0.28, 0.03, pan=0.4)
m.riser(2.9, 3.85, 0.6)
m.reverse_swell(3.85, 0.7, 0.8)
m.bell(3.9, 76, 0.55); m.bell(3.95, 83, 0.35)
m.filter_region('music', 3.85, 4.8, 700)

# ---------- TURN 4.8 – 8.6 ----------
m.pad(4.8, 3.9, [33, 45, 52], 0.9, cutoff=600, attack=0.05)
m.slam(4.88, 52, 0.8)
m.riser(5.1, 6.0, 0.9)
m.impact(6.0, 1.1); m.sub_drop(6.0, 1.2, 0.9); m.slam(6.0, 45, 1.0)
for i, nn in enumerate([69, 72, 76]): m.bell(6.85 + i * 0.08, nn, 0.4)
m.whoosh(7.75, 0.8)
m.zing(7.7, 0.4, 2600, 500, 0.8)   # collapse into a point
m.blip(8.05, 1760, 0.6, 0.25)

# ---------- THE LINE 8.6 – 10.0 ----------
m.sweep(8.6, 9.95, 300, 1800, 0.45)
m.riser(8.7, 10.0, 1.2)
for t in np.arange(8.6, 10.0, 0.125): m.blip(t, 1200 + (t - 8.6) * 900, 0.18, 0.03, pan=0.5 * np.sin(t * 9))

# ---------- DROP 10.0 + LOGO ----------
m.impact(10.0, 1.4); m.sub_drop(10.0, 1.6, 1.0)
m.zing(10.0, 0.5, 600, 2400, 0.7)
for i, nn in enumerate([81, 84, 88, 93]): m.bell(10.3 + i * 0.06, nn, 0.35, pan=-0.3 + i * 0.2)

# ---------- GROOVE 10.0 – 53.0 (with breakdowns) ----------
prog = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
roots = [33, 29, 36, 31]
for k, t0 in enumerate(np.arange(10.0, 53.0, 2.0)):
    m.pad(t0, 2.25, prog[k % 4], 0.75, cutoff=1700, attack=0.08, release=0.3)
    r = roots[k % 4]
    for j, off in enumerate([0, 0.75, 1.0, 1.5, 1.75]): m.bass(t0 + off, r + (12 if j == 3 else 0), 0.22, 0.9)
for i, t in enumerate(np.arange(10.0, 53.0, B)):
    m.kick(t, 0.85)
    m.hat(t + 0.25, 0.75, open_=(i % 4 == 3))
    if i % 2 == 1: m.clap(t, 0.9)
for t in np.arange(13.0, 53.0, 0.125): m.hat(t, 0.22, pan=-0.3)

# markets: cards drop (plucks walking up), caption bell
pent = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96]
for i in range(12):
    t = 13.15 + i * 0.1 + 0.38; m.pluck(t, pent[i], 0.75, pan=-0.6 + 0.11 * i); m.kick(t, 0.18, duck=False)
m.bell(14.1, 81, 0.35)
m.riser(17.6, 18.9, 1.0); m.whoosh(17.9, 0.9)
m.impact(18.95, 0.7)

# leagues: code typing, friends pop in, modes, the match
for i in range(6): m.click(19.6 + i * 0.1, 1.4); m.blip(19.6 + i * 0.1, 1100 + i * 110, 0.35, 0.04)
for i in range(8): m.pluck(20.4 + i * 0.16 + 0.2, [72, 76, 79, 81, 84, 88, 91, 93][i], 0.7, pan=-0.7 + 0.2 * i)
m.bell(21.8, 88, 0.3)
m.whoosh(22.5, 0.8)
m.blip(24.4, 880, 0.6, 0.12); m.blip(24.55, 660, 0.6, 0.12)            # market buy eats the book
m.whoosh(24.75, 0.5)
m.riser(24.7, 25.55, 0.8)
m.impact(25.55, 0.6)
for i, nn in enumerate([84, 88, 91]): m.bell(25.6 + i * 0.07, nn, 0.5)  # matched → minted
m.whoosh(26.7, 0.8)

# trade: select Yes, type $250, buy → fill + confetti
m.click(27.9, 1.5); m.blip(27.9, 1320, 0.5, 0.06)
for t in [28.3, 28.5, 28.7]: m.click(t, 1.3)
for t in np.arange(28.8, 29.25, 0.04): m.blip(t, 1500 + (t - 28.8) * 2500, 0.18, 0.02, pan=0.4)
m.click(29.6, 1.6); m.blip(29.62, 880, 0.9, 0.1); m.blip(29.68, 1320, 0.9, 0.14)
for i, nn in enumerate([84, 88, 91, 96, 100]): m.bell(29.75 + i * 0.05, nn, 0.45, pan=-0.4 + i * 0.2)
for t in np.arange(30.6, 31.8, 0.06): m.blip(t, 1800 + (t - 30.6) * 600, 0.14, 0.02, pan=-0.4)
m.whoosh(32.6, 0.8)

# leaderboard: race (arp), podium rises, crown
arp = [69, 72, 76, 79, 81, 79, 76, 72]
for i, t in enumerate(np.arange(33.4, 36.3, 0.25)): m.pluck(t, arp[i % 8] + 12, 0.32, pan=0.6 if i % 2 else -0.6)
for t0, nn in [(36.3, 76), (36.45, 81), (36.6, 72)]: m.pluck(t0 + 0.2, nn, 0.9); m.kick(t0 + 0.2, 0.3, duck=False)
m.bell(37.0, 93, 0.6); m.bell(37.05, 88, 0.5)
m.whoosh(38.6, 0.8)

# agents: typing, tool calls, bot ticks
CMD = 'claude mcp add --transport http polymates https://polymates-api…run.app/mcp'
for i, ch in enumerate(CMD):
    if ch != ' ': m.click(39.8 + (i + 1) * 1.3 / len(CMD), 0.55)
ASK = 'buy $200 of Senate D if the spread is tight'
for i, ch in enumerate(ASK):
    if ch != ' ': m.click(41.5 + (i + 1) * 0.65 / len(ASK), 0.55)
for t in [42.55, 43.25, 43.95]: m.blip(t, 990, 0.7, 0.08); m.blip(t + 0.35, 1480, 0.5, 0.08)
for i, nn in enumerate([84, 88, 91]): m.bell(44.3 + i * 0.06, nn, 0.4)
m.whoosh(44.55, 0.6)
m.blip(45.6, 1320, 0.4, 0.1); m.blip(46.15, 1760, 0.6, 0.12); m.bell(46.2, 88, 0.3)
m.whoosh(46.6, 0.8)

# quant: the curve draws, stats count, nerd rows
m.sweep(47.6, 49.7, 400, 2000, 0.3)
for i in range(4):
    t0 = 48.5 + i * 0.22; m.pluck(t0 + 0.1, [76, 79, 81, 84][i], 0.7)
    for k in range(5): m.blip(t0 + k * 0.06, 1600 + k * 200, 0.15, 0.02)
for i in range(4): m.click(50.5 + i * 0.12, 1.0); m.blip(50.5 + i * 0.12, 1200 + i * 150, 0.25, 0.04)
m.riser(51.8, 53.0, 1.0)

# ---------- MONTAGE 53.0 – 57.5: hard cuts ----------
m.impact(53.0, 0.8); m.whoosh(53.0, 0.6)
for i in range(3): m.pluck(53.15 + i * 0.1, [81, 86, 88][i], 0.8)
for t in np.arange(53.0, 56.0, 0.25): m.kick(t, 0.75); m.hat(t + 0.125, 0.5)
m.impact(54.5, 0.7); m.whoosh(54.45, 0.6)
for i in range(9): m.blip(54.6 + i * 0.05, 700 + i * 120, 0.25, 0.04, pan=-0.8 + 0.2 * i)
m.pad(53.0, 3.0, [57, 64, 69, 72], 0.7, cutoff=2200, attack=0.05)
for t, nn in [(56.0, 57), (56.5, 60), (57.0, 64)]: m.slam(t, nn, 0.95)

# ---------- FINALE 57.5 – 63 ----------
m.zing(57.6, 1.15, 300, 1500, 1.1)
m.reverse_swell(58.8, 1.2, 1.1)
m.impact(58.8, 1.4); m.sub_drop(58.8, 1.8, 1.0)
m.pad(58.8, 4.2, [45, 57, 64, 69, 72, 76], 1.0, cutoff=2400, attack=0.02, release=2.5)
for i, nn in enumerate([81, 84, 88, 93, 96, 100, 105, 108, 112]): m.bell(59.05 + i * 0.045, nn, 0.22, pan=-0.6 + i * 0.15)
m.bell(59.7, 76, 0.5); m.bell(59.75, 81, 0.5); m.bell(59.8, 88, 0.5)
m.click(60.25, 1.4); m.bell(60.3, 93, 0.45)

m.write('score.wav', fade_out=62.3)
print('ok')
