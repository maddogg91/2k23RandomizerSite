// Create Player form helpers: keeps the secondary position distinct from the primary,
// and shows typical weight/wingspan for the chosen height.
// The server re-validates everything.
(function () {
  const config = JSON.parse(document.getElementById('physicals-config').textContent);
  const position = document.getElementById('position');
  const secondary = document.getElementById('secondary');
  const height = document.getElementById('height');
  const weightHint = document.getElementById('weight-hint');
  const wingspanHint = document.getElementById('wingspan-hint');
  const { limits, realistic } = config;

  const inches = (n) => `${Math.floor(n / 12)}'${n % 12}"`;

  function syncSecondary() {
    for (const opt of secondary.options) opt.disabled = Boolean(opt.value) && opt.value === position.value;
    if (secondary.selectedOptions[0]?.disabled) secondary.value = '';
  }

  function syncHints() {
    const h = Number(height.value);
    if (!h) {
      weightHint.textContent = `${limits.weight.min}–${limits.weight.max} lbs`;
      wingspanHint.textContent = '';
      return;
    }
    const wMin = Math.round(realistic.weight.min.base + realistic.weight.min.perInch * h);
    const wMax = Math.round(realistic.weight.max.base + realistic.weight.max.perInch * h);
    weightHint.textContent = `Typical at ${inches(h)}: ${wMin}–${wMax} lbs`;
    wingspanHint.textContent = `Typical at ${inches(h)}: ${inches(h + realistic.wingspan.minOffset)}–${inches(h + realistic.wingspan.maxOffset)}`;
  }

  position.addEventListener('change', syncSecondary);
  height.addEventListener('change', syncHints);
  syncSecondary();
  syncHints();
})();
