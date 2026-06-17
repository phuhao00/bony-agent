<script lang="ts">
  /** Boonie Bears–inspired chubby brown bear (original SVG, not official asset). */
</script>

<svg class="xiong-body" viewBox="0 0 100 110" aria-hidden="true">
  <defs>
    <radialGradient id="xiongFur" cx="30%" cy="25%" r="78%">
      <stop offset="0%" stop-color="#E8C090" />
      <stop offset="40%" stop-color="#C88850" />
      <stop offset="100%" stop-color="#9A6030" />
    </radialGradient>
    <radialGradient id="xiongBelly" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#F0D8B0" />
      <stop offset="100%" stop-color="#D8B080" />
    </radialGradient>
    <radialGradient id="xiongSnout" cx="50%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#F5DCC0" />
      <stop offset="100%" stop-color="#C89868" />
    </radialGradient>
    <filter id="xiongDrop" x="-18%" y="-15%" width="136%" height="145%">
      <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#3a2818" flood-opacity="0.28" />
    </filter>
  </defs>

  <g class="xiong-chubby" filter="url(#xiongDrop)">
    <ellipse class="xiong-ground" cx="50" cy="106" rx="24" ry="3.2" fill="#3a2818" opacity="0.18" />

    <!-- back arm -->
    <ellipse class="xiong-arm back" cx="18" cy="68" rx="7" ry="11" fill="url(#xiongFur)" transform="rotate(-25 18 68)" />

    <!-- body -->
    <ellipse class="xiong-torso" cx="50" cy="72" rx="30" ry="28" fill="url(#xiongFur)" />
    <ellipse class="xiong-belly" cx="50" cy="76" rx="20" ry="18" fill="url(#xiongBelly)" />
    <ellipse class="xiong-belly-shine" cx="44" cy="70" rx="9" ry="6" fill="#fff" opacity="0.2" />

    <!-- legs -->
    <ellipse class="xiong-foot left" cx="36" cy="96" rx="9" ry="5" fill="url(#xiongFur)" />
    <ellipse class="xiong-foot right" cx="62" cy="96" rx="9" ry="5" fill="url(#xiongFur)" />

    <!-- head -->
    <circle class="xiong-head" cx="50" cy="36" r="26" fill="url(#xiongFur)" />
    <circle class="xiong-head-shine" cx="40" cy="26" r="10" fill="#fff" opacity="0.22" />

    <!-- ears -->
    <circle class="xiong-ear left" cx="30" cy="14" r="9" fill="url(#xiongFur)" />
    <circle class="xiong-ear right" cx="70" cy="14" r="9" fill="url(#xiongFur)" />
    <circle class="xiong-ear-inner left" cx="30" cy="14" r="5" fill="#D8A870" opacity="0.65" />
    <circle class="xiong-ear-inner right" cx="70" cy="14" r="5" fill="#D8A870" opacity="0.65" />

    <!-- front arm -->
    <ellipse class="xiong-arm front" cx="80" cy="66" rx="7" ry="11" fill="url(#xiongFur)" transform="rotate(20 80 66)" />
  </g>

  <g class="xiong-face-features">
    <ellipse class="eye left" cx="40" cy="34" rx="3.2" ry="4" fill="#1a1018" />
    <ellipse class="eye right" cx="60" cy="34" rx="3.2" ry="4" fill="#1a1018" />
    <circle class="eye-shine left" cx="41" cy="32.5" r="1" fill="#fff" />
    <circle class="eye-shine right" cx="61" cy="32.5" r="1" fill="#fff" />

    <ellipse class="xiong-snout" cx="50" cy="44" rx="12" ry="9" fill="url(#xiongSnout)" />
    <ellipse class="xiong-nose" cx="50" cy="42" rx="5.5" ry="4" fill="#2a1810" />
    <ellipse class="xiong-nose-shine" cx="48" cy="40.5" rx="1.8" ry="1.2" fill="#fff" opacity="0.35" />

    <path
      class="mouth"
      fill="none"
      stroke="#3a2818"
      stroke-width="1.8"
      stroke-linecap="round"
      d="M44 50 Q50 54 56 50"
    />
  </g>
</svg>
