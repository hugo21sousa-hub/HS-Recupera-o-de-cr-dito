# Monta o vídeo do site: corta o início, encaixa cada frase da narração na cena dela, trilha com ducking e logo.
# Uso: python3 scripts-video-montar.py <narracao.m4a> <gravacao.webm> <saida.mp4>  (precisa de trilha2.wav e marca.png na pasta)
import subprocess, sys
F, W, saida = sys.argv[1], sys.argv[2], sys.argv[3]
CORTE = 1.7          # começo do vídeo (antes disso é só o carregamento)
DUR = 84.8 - CORTE
# (início, fim) de cada frase no áudio  ->  instante da cena no vídeo original
frases = [((0.00, 4.23), 1.75), ((4.70, 8.62), 5.35), ((9.08, 13.98), 15.05), ((14.47, 18.29), 24.65),
          ((18.75, 24.39), 30.15), ((24.92, 32.53), 36.15), ((32.92, 38.38), 54.25), ((38.78, 47.37), 60.25), ((47.68, 51.35), 79.45)]
partes, rotulos = [], []
for i, ((a, b), alvo) in enumerate(frases):
    a2, b2 = max(0, a - 0.05), b + 0.12
    atraso = int(round((alvo - CORTE) * 1000))
    partes.append(f"[1:a]atrim={a2}:{b2},asetpts=PTS-STARTPTS,afade=t=in:d=0.04,afade=t=out:st={b2-a2-0.08:.2f}:d=0.08,adelay={atraso}|{atraso}[f{i}]")
    rotulos.append(f"[f{i}]")
filtro = ";".join(partes)
filtro += f";{''.join(rotulos)}amix=inputs={len(rotulos)}:normalize=0,highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7,apad=whole_dur={DUR},atrim=0:{DUR},asplit=2[voz][chave]"
filtro += ";[2:a]volume=0.22[mus];[mus][chave]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[musd];[voz][musd]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]"
filtro += f";[0:v]fps=30[v0];[v0][3:v]overlay=x=W-w-22:y=H-h-22:enable='between(t,3.6,{79.25-CORTE-0.1:.2f})',format=yuv420p[v]"
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(CORTE), '-i', W, '-i', F, '-i', 'trilha2.wav', '-i', 'marca.png',
       '-filter_complex', filtro, '-map', '[v]', '-map', '[a]', '-t', str(DUR), '-c:v', 'libx264', '-preset', 'slow', '-crf', '26',
       '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', saida]
subprocess.run(cmd, check=True)
print('ok', saida)
