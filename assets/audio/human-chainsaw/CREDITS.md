# Credits - human chainsaw / gore layer (assets/audio/human-chainsaw/)

Every clip in this folder is a processed excerpt of one of the 13 third-party recordings below (sources 01-13 of `assets/audio/human-manual-download/`). Licences are CC0 1.0 or CC BY 3.0/4.0; nothing is ripped from a game or film. The recordings were downloaded by hand by a human (no automated access to freesound.org or bigsoundbank.com was made); title, author, licence and source URL come from the file names plus the earlier research manifest `quarantine-chainsaw-samples/manifest.dropped.json`. The file-name licence tag and the research manifest agree for all 13 sources.

## Processing applied to every clip (unless noted)

- decoded from the lossy mp3 supplied, downmixed to mono (L+R average), resampled to 44.1 kHz;
- zero-phase 4th-order Butterworth high-pass (22 Hz for chainsaw sources, 30/50/60/100 Hz for sources 10/12/13/11 as listed below);
- cut to the listed segment; one-shots get a 2-5 ms fade-in and a 30-300 ms fade-out; loops get NO edge fades;
- loops: loop points chosen at an upward zero crossing with maximal waveform correlation across the seam, the last N ms replaced by an equal-power (correlation-compensated) crossfade into the N ms of source before the loop start, so wrapping is sample-continuous;
- linear gain (role-level loudness match, peak <= -1 dBFS); occasional soft limiting / envelope flattening as listed per source;
- encoded mono Ogg Vorbis, 44.1 kHz, libvorbis quality 4 (ffmpeg). Two lossy generations (mp3 then Vorbis) - do not re-encode again.

## Required attribution (CC BY)

Show these credits in the game's credits screen or documentation. The clips are modified (see per-source lists); no endorsement by the authors is implied.

- "Chainsaw Crosscutting  3.wav" by Benboncan (https://freesound.org/people/Benboncan/sounds/64398/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)

- "chainsaw and little tree.wav" by Kyster (https://freesound.org/people/Kyster/sounds/118657/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)

- "Chainsaw Idle loops" by Audionautics (https://freesound.org/people/Audionautics/sounds/171652/), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)

- "Chainsaw cutting through flesh" by Audionautics (https://freesound.org/people/Audionautics/sounds/171653/), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)


## Sources

### 01. chainsaw start and idle.flac

- Author: kyles
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://freesound.org/people/kyles/sounds/453259/
- Original file used: `01_fs453259_chainsaw-start-and-idle_kyles_CC0.mp3` (mp3, 48 kHz stereo, ~209 kbps)
- Attribution: not required (CC0 / public-domain dedication)
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. Single pull-cord rip and idle warm-up: dead-air gap shortened with a 30 ms splice in sawStart_02.
- Derived files:
  - `sawStart_02.ogg` (sawStart, 6.320 s): source 0.000-1.150 s + 1.800-7.000 s (30 ms splice)
  - `sawIdle_02.ogg` (sawIdle, 2.291 s, seamless loop): source 7.449-9.940 s

### 02. Chainsaw gasoline-powered.wav

- Author: aoristos
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://freesound.org/people/aoristos/sounds/235795/
- Original file used: `02_fs235795_chainsaw-gasoline-full-throttle_aoristos_CC0.mp3` (mp3, 44.1 kHz stereo, ~187 kbps)
- Attribution: not required (CC0 / public-domain dedication)
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. Stereo channels only weakly correlated (r=0.24): mono downmix is a plain L+R average.
- Derived files:
  - `sawFull_01.ogg` (sawFull, 2.456 s, seamless loop): source 12.074-14.650 s
  - `sawRev_01.ogg` (sawRev, 1.600 s): source 10.150-11.750 s
  - `sawRev_02.ogg` (sawRev, 1.700 s): source 20.900-22.600 s
  - `sawRev_03.ogg` (sawRev, 1.500 s): source 26.150-27.650 s

### 03. Chainsaw #2

- Author: Joseph SARDIN (BigSoundBank.com)
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://bigsoundbank.com/sound-0707-chainsaw-2.html
- Original file used: `03_bsb0707_chainsaw-2-full-throttle_joseph-sardin_CC0.mp3` (mp3, 48 kHz mono, 320 kbps)
- Attribution: not required (CC0 / public-domain dedication); optional credit requested by the author: "Additional sounds: Joseph SARDIN - BigSoundBank.com"
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. sawStart_03 keeps the two failed pulls and the catch-into-rev (pull section before the catch boosted +9 dB with a 50 ms ramp); sawHit_10 is a pitch-sag (load onset) excerpt.
- Derived files:
  - `sawStart_03.ogg` (sawStart, 5.650 s): source 8.950-14.600 s
  - `sawFull_03.ogg` (sawFull, 3.047 s, seamless loop): source 107.390-110.558 s
  - `sawFull_05.ogg` (sawFull, 3.027 s, seamless loop): source 50.698-53.875 s
  - `sawRev_06.ogg` (sawRev, 2.100 s): source 15.250-17.350 s
  - `sawHit_10.ogg` (sawHit, 0.500 s): source 34.300-34.800 s

### 04. Chainsaw (Starting)

- Author: Joseph SARDIN (BigSoundBank.com)
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://bigsoundbank.com/sound-0982-chainsaw-starting.html
- Original file used: `04_bsb0982_chainsaw-starting_joseph-sardin_CC0.mp3` (mp3, 48 kHz mono, 320 kbps)
- Attribution: not required (CC0 / public-domain dedication); optional credit requested by the author: "Additional sounds: Joseph SARDIN - BigSoundBank.com"
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. sawStart_01 pull section before the catch boosted +6 dB with a 40 ms ramp; sawShutdown_01 is the idle-then-die tail of the recording.
- Derived files:
  - `sawStart_01.ogg` (sawStart, 6.100 s): source 5.200-11.300 s
  - `sawIdle_01.ogg` (sawIdle, 3.108 s, seamless loop): source 15.079-18.386 s
  - `sawShutdown_01.ogg` (sawShutdown, 2.150 s): source 35.550-37.700 s

### 05. Chainsaw, Using

- Author: Joseph SARDIN (BigSoundBank.com)
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://bigsoundbank.com/sound-0983-chainsaw-using.html
- Original file used: `05_bsb0983_chainsaw-using-shutdown_joseph-sardin_CC0.mp3` (mp3, 48 kHz mono, 320 kbps)
- Attribution: not required (CC0 / public-domain dedication); optional credit requested by the author: "Additional sounds: Joseph SARDIN - BigSoundBank.com"
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. sawShutdown_02 is the last ~1.9 s of the recording (idle winding down); sawIdle_04 is a quiet steady idle stretch (gain about +15 dB).
- Derived files:
  - `sawIdle_04.ogg` (sawIdle, 2.360 s, seamless loop): source 105.428-107.988 s
  - `sawRev_05.ogg` (sawRev, 2.360 s): source 11.620-13.980 s
  - `sawShutdown_02.ogg` (sawShutdown, 1.880 s): source 119.400-121.280 s

### 06. Chainsaw Crosscutting  3.wav

- Author: Benboncan
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Source: https://freesound.org/people/Benboncan/sounds/64398/
- Original file used: `06_fs64398_chainsaw-crosscutting-3_benboncan_CCBY4.mp3` (mp3, 44.1 kHz stereo, ~179 kbps)
- Required attribution: "Chainsaw Crosscutting  3.wav" by Benboncan (https://freesound.org/people/Benboncan/sounds/64398/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. sawHit_08/09 are engine bog-down bites from the crosscutting run.
- Derived files:
  - `sawFull_04.ogg` (sawFull, 3.310 s, seamless loop): source 25.145-28.605 s
  - `sawHit_08.ogg` (sawHit, 0.500 s): source 7.430-7.930 s
  - `sawHit_09.ogg` (sawHit, 0.500 s): source 19.722-20.222 s

### 07. chainsaw and little tree.wav

- Author: Kyster
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Source: https://freesound.org/people/Kyster/sounds/118657/
- Original file used: `07_fs118657_chainsaw-and-little-tree_kyster_CCBY4.mp3` (mp3, 44.1 kHz stereo, ~186 kbps)
- Required attribution: "chainsaw and little tree.wav" by Kyster (https://freesound.org/people/Kyster/sounds/118657/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. Ambient bed (birds) in the first 8 s and after 35.7 s of the source is not used.
- Derived files:
  - `sawFull_02.ogg` (sawFull, 2.900 s, seamless loop): source 20.910-23.929 s
  - `sawRev_04.ogg` (sawRev, 1.600 s): source 18.850-20.450 s

### 08. Chainsaw Idle loops

- Author: Audionautics
- License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Source: https://freesound.org/people/Audionautics/sounds/171652/
- Original file used: `08_fs171652_chainsaw-idle-loops_audionautics_CCBY3.mp3` (mp3, 44.1 kHz stereo, ~136 kbps)
- Required attribution: "Chainsaw Idle loops" by Audionautics (https://freesound.org/people/Audionautics/sounds/171652/), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. Source is three idle blocks separated by digital silence; only inside a block is used.
- Derived files:
  - `sawIdle_03.ogg` (sawIdle, 3.348 s, seamless loop): source 6.905-10.453 s

### 09. Chainsaw cutting through flesh

- Author: Audionautics
- License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Source: https://freesound.org/people/Audionautics/sounds/171653/
- Original file used: `09_fs171653_chainsaw-cutting-through-flesh_audionautics_CCBY3.mp3` (mp3, 44.1 kHz stereo, ~123 kbps)
- Required attribution: "Chainsaw cutting through flesh" by Audionautics (https://freesound.org/people/Audionautics/sounds/171653/), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)
- Modifications: mono downmix, 44.1 kHz resample, 22 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. Layered saw + gore foley (noise-gated bursts separated by digital silence).
- Derived files:
  - `sawHit_01.ogg` (sawHit, 0.420 s): source 7.559-7.979 s
  - `sawHit_02.ogg` (sawHit, 0.420 s): source 13.040-13.460 s
  - `sawHit_03.ogg` (sawHit, 0.400 s): source 28.798-29.198 s
  - `sawHit_04.ogg` (sawHit, 0.420 s): source 37.459-37.879 s
  - `sawHit_05.ogg` (sawHit, 0.400 s): source 8.329-8.729 s
  - `sawHit_06.ogg` (sawHit, 0.360 s): source 2.837-3.197 s
  - `sawHit_07.ogg` (sawHit, 0.420 s): source 20.516-20.936 s
  - `sawGore_04.ogg` (sawGore, 0.900 s): source 7.550-8.450 s
  - `sawGore_05.ogg` (sawGore, 1.000 s): source 8.300-9.300 s
  - `sawGore_06.ogg` (sawGore, 1.400 s): source 12.050-13.450 s
  - `sawGore_07.ogg` (sawGore, 1.300 s): source 37.400-38.700 s

### 10. Gore Impact - "LOT OF HEART"

- Author: magnuswaker
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://freesound.org/people/magnuswaker/sounds/641046/
- Original file used: `10_fs641046_gore-impact-lot-of-heart_magnuswaker_CC0.mp3` (mp3, 48 kHz stereo, ~180 kbps)
- Attribution: not required (CC0 / public-domain dedication)
- Modifications: mono downmix, 44.1 kHz resample, 30 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. Source is heavily clipped/limited (about 3% of decoded samples at full scale); scaled by -6 dB before processing.
- Derived files:
  - `gib_01.ogg` (gib, 0.540 s): source 0.060-0.600 s
  - `gib_02.ogg` (gib, 0.990 s): source 0.060-1.050 s

### 11. Chicken Meat Slime

- Author: qubodup
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://freesound.org/people/qubodup/sounds/211605/
- Original file used: `11_fs211605_chicken-meat-slime_qubodup_CC0.mp3` (mp3, 48 kHz stereo, ~240 kbps)
- Attribution: not required (CC0 / public-domain dedication)
- Modifications: mono downmix, 44.1 kHz resample, 100 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. 50 Hz mains hum removed by a 100 Hz high-pass; sawGore_01 and gib_10 additionally soft-limited (tanh at 5.0x / 3.5x rms) to reduce the crest factor of the pops.
- Derived files:
  - `sawGore_01.ogg` (sawGore, 2.495 s, seamless loop): source 1.890-4.535 s
  - `gib_10.ogg` (gib, 0.500 s): source 5.360-5.860 s

### 12. guts_and_entrails.wav

- Author: nightmareszn
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://freesound.org/people/nightmareszn/sounds/464768/
- Original file used: `12_fs464768_guts-and-entrails_nightmareszn_CC0.mp3` (mp3, 44.1 kHz stereo, ~206 kbps)
- Attribution: not required (CC0 / public-domain dedication)
- Modifications: mono downmix, 44.1 kHz resample, 50 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. 50 Hz high-pass; sawGore_02 soft-limited (tanh at 6x rms).
- Derived files:
  - `sawGore_02.ogg` (sawGore, 2.875 s, seamless loop): source 52.400-55.475 s
  - `gib_06.ogg` (gib, 0.550 s): source 37.700-38.250 s
  - `gib_07.ogg` (gib, 0.600 s): source 51.250-51.850 s
  - `gib_08.ogg` (gib, 0.322 s): source 24.658-24.980 s
  - `gib_09.ogg` (gib, 0.487 s): source 29.163-29.650 s
  - `exploderBurst_03.ogg` (exploderBurst, 0.982 s): source 51.118-52.100 s

### 13. Blood Gush / Spray

- Author: clif_creates
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Source: https://freesound.org/people/clif_creates/sounds/345985/
- Original file used: `13_fs345985_blood-gush-spray_clif-creates_CC0.mp3` (mp3, 48 kHz mono, ~201 kbps)
- Attribution: not required (CC0 / public-domain dedication)
- Modifications: mono downmix, 44.1 kHz resample, 60 Hz high-pass, segment cuts, fades, gain, Vorbis q4 re-encode. 60 Hz high-pass; sawGore_03 has its slow level decay divided out (0.4 s envelope, max +-6 dB) before looping.
- Derived files:
  - `sawGore_03.ogg` (sawGore, 2.740 s, seamless loop): source 2.385-5.325 s
  - `gib_03.ogg` (gib, 0.416 s): source 5.634-6.050 s
  - `gib_04.ogg` (gib, 0.374 s): source 6.576-6.950 s
  - `gib_05.ogg` (gib, 0.416 s): source 8.384-8.800 s
  - `exploderBurst_01.ogg` (exploderBurst, 1.726 s): source 0.174-1.900 s
  - `exploderBurst_02.ogg` (exploderBurst, 1.447 s): source 5.603-7.050 s
