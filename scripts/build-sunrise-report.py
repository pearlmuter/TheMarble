"""Build the retained visual evidence from validate-sunrise.mjs outputs."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

out=Path('artifacts/sunrise-validation')
r=json.loads((out/'report.json').read_text())
rows=r['rows']
distant=[v for v in rows if v.get('distance',7)==7]
max_error=max(v for row in rows for v in row['relative'])*100
max_t=max(v for row in r['transmissionRows'] for v in row['absolute'])*100
p=[row for row in distant if row['clearance']==-.3]
colors=['#c04646','#298c60','#3675ca']
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,axes=plt.subplots(1,2,figsize=(11.8,4.7),layout='constrained')
for c,(name,color) in enumerate(zip(['Red','Green','Blue'],colors)):
    axes[0].plot([v['reference'][c] for v in p],[v['h'] for v in p],color=color,label=name+' reference')
    axes[0].scatter([v['gpu'][c] for v in p],[v['h'] for v in p],color=color,s=18,marker='x')
axes[0].set(xlabel='Single-scattered radiance (model units)',ylabel='Ray tangent height above surface (km)',title='Before geometric solar emergence')
axes[0].legend(frameon=False,fontsize=8)
axes[0].text(.98,.62,'Lines: independent integration\nCrosses: corrected renderer',transform=axes[0].transAxes,ha='right',fontsize=8)
heights=sorted(set(v['h'] for v in distant))
baseline=json.loads((out/'baseline-report.json').read_text()) if (out/'baseline-report.json').exists() else None
if baseline:
    old=[max(e for v in baseline['rows'] if v['h']==h for e in v['relative'])*100 for h in heights]
    axes[1].plot(heights,old,'o-',color='#9b6157',label='Before validation fixes')
new=[max(e for v in distant if v['h']==h for e in v['relative'])*100 for h in heights]
axes[1].plot(heights,new,'o-',color='#267b69',label='Corrected renderer')
axes[1].axhline(2,color='#68747b',ls='--',lw=1,label='Chosen 2% acceptance threshold')
axes[1].set(xlabel='Ray tangent height above surface (km)',ylabel='Maximum normalized channel error (%)',title='Numerical error at the distant viewpoint',ylim=(0,6))
axes[1].legend(frameon=False,fontsize=8)
fig.savefig(out/'numerical-check.svg')
fig.savefig(out/'numerical-check.png',dpi=160)
plt.close(fig)

cases=[('-.6','-0.6','Sun center 0.6° below limb','The full solar disc is hidden. The thin arc remains.'),('-.3','-0.3','Sun center 0.3° below limb','Just before geometric first contact; no direct disc is visible.'),('0','0','Sun center at limb','Partial emergence; glare comes from visible solar pixels.'),('.3','0.3','Sun center 0.3° above limb','The geometric disc clears the solid Earth; low rays still cross air.')]
cards=''.join(f'''<figure><a href="sequence-{file}.png"><img src="sequence-{file}.png" alt="{title}"></a><figcaption><b>{title}</b><br>{caption}</figcaption></figure>''' for _,file,title,caption in cases)
html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbital sunrise — validation</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f7f8;color:#152530;font:16px/1.65 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:48px 24px 80px}h1{font-size:clamp(30px,5vw,48px);line-height:1.15;letter-spacing:-.035em}h2{font-size:24px;margin-top:42px}p{max-width:880px}.eyebrow{color:#487d81;text-transform:uppercase;letter-spacing:.14em;font-size:12px}.lead{font-size:21px}.status{background:#e5f1eb;border-left:4px solid #318069;padding:16px 22px}.limits{background:#fff1d8;border-left:4px solid #b17b29;padding:16px 22px;margin:24px 0}a{color:#176b87}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0;background:white;border:1px solid #d5dde0;border-radius:8px;overflow:hidden}figure img{display:block;width:100%}figcaption{padding:16px;font-size:14px}table{border-collapse:collapse;width:100%;background:white;font-size:14px}td,th{text-align:left;padding:13px;border-bottom:1px solid #d8e1e5;vertical-align:top}th{background:#e9eef1}blockquote{margin:0;border-left:4px solid #577b98;background:#e9f0f5;padding:20px;font-size:19px}.chart{width:100%;background:white;border-radius:8px}small{color:#53636e}code{font-size:13px}summary{cursor:pointer}.crop{height:280px;position:relative;overflow:hidden;background:black}.crop img{position:absolute;width:2800px;max-width:none;height:2200px;left:calc(50% - 582px);top:-900px}.crop-label{position:absolute;right:12px;bottom:10px;color:white;font-size:11px;text-shadow:0 1px 3px black}@media(max-width:720px){.grid{grid-template-columns:1fr}main{padding:24px 16px}td,th{padding:8px}}
</style><main><p class="eyebrow">TheMarble · scientific illustration · 5 September 2026</p><h1>Does the atmosphere glow<br>before the Sun appears?</h1><p class="lead">Yes, in the tested sunrise geometries. The blue upper arc is supported by an independent scattering calculation and appears while Earth still hides the full solar disc.</p>
<div class="status"><b>Validated within a simplified, straight-ray atmosphere.</b><br>48 atmospheric rays at two viewing distances; separate source-occlusion checks; native-resolution sunrise captures; independent optical-depth integration.</div>
<h2>The sequence at the app’s distance</h2><p>The observer is seven Earth radii from the center. These are controlled camera positions, not a prediction of elapsed sunrise time. Click an image for its original 1400 × 1100 resolution. Packaged Earth textures are used for repeatability.</p><div class="grid">'''+cards+'''</div>
<h2>The thin arc, enlarged</h2><p>These crops enlarge the same pre-emergence screenshots by 2×. Exposure and colors are unchanged. At a 1000-pixel Earth diameter, a 20–40 km layer spans about 1.6–3.2 pixels.</p><div class="grid">'''+''.join(f'<figure><div class="crop"><img src="sequence-{v}.png" alt="Enlarged atmosphere before solar emergence"><span class="crop-label">2× enlargement</span></div><figcaption>Solar center {v}° relative to the geometric limb.</figcaption></figure>' for v in ['-0.6','-0.3'])+'''</div>
<h2>Independent numerical checks</h2><img class="chart" src="numerical-check.svg" alt="Radiance by tangent height and numerical error before and after corrections"><p><small>Reference: double-precision midpoint integration of the same molecular, aerosol, and ozone profiles. It does not call the runtime lookup or march functions. Only the physical coefficients are shared. The channel colors describe this RGB model; they are not a full spectral color calculation.</small></p>
<table><tr><th>Check</th><th>Result</th><th>What it establishes</th></tr>
<tr><td>Single-scattered light</td><td>Maximum discrepancy '''+f'{max_error:.2f}'+'''%</td><td>Agreement with an independently integrated version of the same model, across 48 rays at 1, 5, 10, 20, 40 and 60 km; four solar positions; distant and ISS-altitude observers.</td></tr>
<tr><td>Atmospheric transmission</td><td>Maximum difference '''+f'{max_t:.3f}'+''' percentage points</td><td>Eight tangent heights, 0.01–60 km, compared with 4096-step integration.</td></tr>
<tr><td>Reference convergence</td><td>Less than 0.001% in the three selected cases</td><td>Doubling both path resolutions changes the reference negligibly in those cases.</td></tr>
<tr><td>Solar blocking</td><td>Zero direct solar signal through Earth</td><td>The separate browser regression checks partial and total occultation. Atmospheric light is measured independently of glare.</td></tr>
</table><p><small>The relative-error denominator is floored at 10⁻⁵ model radiance to avoid meaningless percentages on nearly black channels. These percentages quantify numerical agreement, not accuracy against the real atmosphere. Approximate multiple scattering is present in screenshots but has not been independently certified.</small></p>
<h2>Corrections made during validation</h2><p>The renderer could classify a ray missing Earth as a surface hit. Correcting that exposed a loss of very faint blue light from dividing tiny transmission values. It now uses a direct, reciprocal outward transmission lookup. The outer atmospheric arc uses 24 integration steps; rays landing on Earth keep 12. The sampled distant-view error fell from 5.4% to below 1.5%.</p>
<div class="limits"><b>What remains approximate</b><ul><li>Refraction is absent: apparent emergence timing and solar flattening are not accurate.</li><li>Atmospheric profiles are globally uniform; actual conditions vary.</li><li>Three RGB channels and approximate multiple scattering do not certify exact real-world colors.</li><li>The Sun’s brightness, star visibility and night-side details are adjusted for readability. This is not a single calibrated exposure or an exact naked-eye view.</li></ul></div>
<h2>A clear explanation for the classroom</h2><blockquote>“Sunlight reaches air above Earth’s edge while the planet still hides the Sun from us. That air scatters some light toward us, making a thin blue arc. This visualization calculates that process in a simplified atmosphere. Brightness is adjusted so we can see several features together; real colors and visibility depend on conditions and exposure.”</blockquote>
<h2>Evidence and sources</h2><ul><li><a href="report.json">Numerical results and pass/fail checks</a></li><li><a href="https://science.nasa.gov/earth/earth-observatory/smoke-in-the-stratosphere-148276/">NASA: blue molecular scattering and warmer lower atmosphere</a> — a qualitative reference; the image was contrast enhanced.</li><li><a href="https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html">Bruneton: atmospheric transport and transmittance</a></li><li><a href="https://ntrs.nasa.gov/citations/19630006416">NASA: refraction of the setting Sun viewed from space</a></li><li><a href="https://science.nasa.gov/blogs/earth-matters/2011/09/28/where-are-the-stars/">NASA: how exposure affects star visibility</a></li></ul><p><small>The supplied screenshot was used to identify the visual concern. It already contains a visible Sun and lacks verified exposure/camera metadata, so it cannot establish the pre-emergence sequence or absolute brightness. This report adds controlled views and numerical evidence.</small></p></main></html>'''
(out/'index.html').write_text(html)
