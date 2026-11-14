# Trilha instrumental original (gerada por código): pad + arpejo + baixo, progressão C - G - Am - F.
import numpy as np, wave, sys
sr = 44100
dur = float(sys.argv[2]) if len(sys.argv) > 2 else 86.0
bpm = 92
beat = 60 / bpm
n = int(sr * dur)
L = np.zeros(n); R = np.zeros(n)
def hz(m): return 440 * 2 ** ((m - 69) / 12)
prog = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]  # C, G, Am, F
bar = 4 * beat
def env_pad(len_s, a=1.2, r=1.6):
    t = np.arange(int(sr * len_s)) / sr
    e = np.minimum(1, t / a) * np.minimum(1, np.maximum(0, (len_s - t) / r))
    return t, e
rng = np.random.default_rng(7)
t_all = np.arange(n) / sr
i = 0; start = 0.0
while start < dur:
    acorde = prog[i % 4]
    # pad (duas oitavas, leve desafinação estéreo)
    ln = bar + 1.6
    t, e = env_pad(ln)
    s = int(start * sr); f = min(n, s + len(t)); k = f - s
    for nota in acorde:
        for det, canal in ((-0.12, 'L'), (0.12, 'R')):
            fq = hz(nota) * 2 ** (det / 12 / 10)
            w = (np.sin(2 * np.pi * fq * t[:k]) + 0.35 * np.sin(2 * np.pi * 2 * fq * t[:k]) + 0.15 * np.sin(2 * np.pi * 3 * fq * t[:k])) * e[:k] * 0.045
            (L if canal == 'L' else R)[s:f] += w
    # baixo
    t2 = np.arange(int(sr * bar)) / sr
    eb = np.minimum(1, t2 / 0.05) * np.exp(-t2 / 1.8)
    s2 = int(start * sr); f2 = min(n, s2 + len(t2)); k2 = f2 - s2
    b = np.sin(2 * np.pi * hz(acorde[0] - 24) * t2[:k2]) * eb[:k2] * 0.16
    L[s2:f2] += b; R[s2:f2] += b
    # arpejo em colcheias (entra depois de 2 compassos)
    if i >= 2:
        notas = [acorde[0] + 12, acorde[1] + 12, acorde[2] + 12, acorde[1] + 24]
        for j in range(8):
            ts = start + j * beat / 2
            if ts >= dur: break
            tt = np.arange(int(sr * 0.9)) / sr
            ea = np.minimum(1, tt / 0.005) * np.exp(-tt / 0.28)
            fq = hz(notas[j % 4])
            w = (np.sin(2 * np.pi * fq * tt) + 0.2 * np.sin(2 * np.pi * 2 * fq * tt)) * ea * 0.055
            s3 = int(ts * sr); f3 = min(n, s3 + len(tt)); k3 = f3 - s3
            pan = 0.35 if j % 2 else -0.35
            L[s3:f3] += w[:k3] * (1 - pan); R[s3:f3] += w[:k3] * (1 + pan)
    start += bar; i += 1
# reverb simples (convolução com ruído decrescente)
ir_len = int(sr * 1.8)
ir = rng.standard_normal(ir_len) * np.exp(-np.arange(ir_len) / (sr * 0.45))
ir /= np.abs(ir).sum() / 6
def conv(x): return np.fft.irfft(np.fft.rfft(x, len(x) + ir_len) * np.fft.rfft(ir, len(x) + ir_len))[: len(x)]
L = 0.75 * L + 0.25 * conv(L); R = 0.75 * R + 0.25 * conv(R)
# fade in/out e normalização
fi, fo = int(sr * 2), int(sr * 4)
env = np.ones(n); env[:fi] = np.linspace(0, 1, fi); env[-fo:] = np.linspace(1, 0, fo)
L *= env; R *= env
pk = max(np.abs(L).max(), np.abs(R).max()); L *= 0.7 / pk; R *= 0.7 / pk
st = (np.stack([L, R], 1) * 32767).astype(np.int16)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(st.tobytes())
print('ok', dur)
