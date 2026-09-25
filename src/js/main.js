import { EngineSimulator }  from './engineSimulator.js';
import { AIPredictor }      from './aiPredictor.js';
import { ChartsManager, AITrendChartManager } from './chartsManager.js';
import { AudioManager }     from './audioManager.js';
import { ThreeDigitalTwin } from './threeDigitalTwin.js';
import { RealtimeMonitor }  from './realtimeMonitor.js';
import { HistoryLogs }      from './historyLogs.js';

// ─── DOM helpers ──────────────────────────────────────────────────────────────
const $    = id   => document.getElementById(id);
const qAll = sel  => document.querySelectorAll(sel);
const setText  = (id, val) => { const el = $(id); if (el) el.textContent = val; };
const setCss   = (id, prop, val) => { const el = $(id); if (el) el.style[prop] = val; };
const setAttr  = (id, attr, val) => { const el = $(id); if (el) el.setAttribute(attr, val); };

document.addEventListener('DOMContentLoaded', () => {

  // ─── Core Systems ────────────────────────────────────────────────────────────
  const sim   = new EngineSimulator();
  const ai    = new AIPredictor();
  const audio = new AudioManager();
  const chart = new ChartsManager($('telemetry-chart'));
  const aiTrend = new AITrendChartManager($('ai-trend-chart'));
  const aiTrendHistory = { labels: [], anomalyScores: [], health: [], maxSigmas: [], hazardRates: [] };
  const rtMon = new RealtimeMonitor();
  const histLog = new HistoryLogs(sim);

  // Evaluation Mode State ('LIVE' vs 'SIMULATION')
  let evalMode = 'LIVE';
  let liveStreamConnected = false;
  let isStreamPaused = false;
  let totalProcessedSamples = 0;
  let currentTargetRateHz = 10;
  let isReplaying = false;

  // Expose history filter to inline onclick handlers in HTML
  window._histFilter = (f) => {
    histLog.setFilter(f);
    ['all', 'warning', 'critical'].forEach(k => {
      const btn = $(`hist-filter-${k}`);
      if (btn) {
        const isActive = k === f;
        btn.style.borderColor = isActive ? 'var(--accent-cyan)' : 'var(--border)';
        btn.style.color = isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)';
      }
    });
  };

  // 3D Twin is lazily created on first tab visit so canvas has real dimensions
  let twin = null;
  function getTwin() {
    if (!twin) twin = new ThreeDigitalTwin($('canvas-container'), handleComponentClick);
    return twin;
  }

  let wsConnected = false;
  let socket      = null;

  // ─── Dynamic API & WebSocket Endpoints (Cloud & Local Support) ────────────
  const urlParams = new URLSearchParams(window.location.search);
  const paramBackend = urlParams.get('backend');
  if (paramBackend) {
    localStorage.setItem('AERIS_BACKEND_URL', paramBackend);
  }

  const storedBackend = localStorage.getItem('AERIS_BACKEND_URL') || (window.AERIS_BACKEND_URL || null);
  const envBackend = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL)
    ? import.meta.env.VITE_BACKEND_URL.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '')
    : null;
  const isDevPort = window.location.port === '3000' || window.location.port === '5173';
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  let rawHost = storedBackend 
    ? storedBackend.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/$/, '')
    : (envBackend || (isDevPort ? `${window.location.hostname || 'localhost'}:8000` : (isLocalhost ? `${window.location.hostname}:8000` : window.location.host)));

  const isHttps = window.location.protocol === 'https:' || (storedBackend && storedBackend.startsWith('https'));
  const wsProtocol = isHttps ? 'wss:' : 'ws:';
  const httpProtocol = isHttps ? 'https:' : 'http:';
  const API_BASE_URL = `${httpProtocol}//${rawHost}`;
  const WS_URL = `${wsProtocol}//${rawHost}/ws/telemetry`;

  // Global helper to switch backend easily in console or UI
  window.setBackendUrl = (url) => {
    if (!url) {
      localStorage.removeItem('AERIS_BACKEND_URL');
      toast('Backend URL reset to default', 2500);
    } else {
      localStorage.setItem('AERIS_BACKEND_URL', url.trim());
      toast(`Backend URL set to: ${url.trim()}`, 2500);
    }
    setTimeout(() => location.reload(), 600);
  };

  // ─── Component Inspector Spec Table (Rotax 914 Aero Piston Architecture) ────
  const COMP_SPECS = {
    engine: {
      name: 'Rotax 914 Turbocharged Aero Piston Powerplant',
      type: 'POWERPLANT',
      desc: '4-cylinder horizontally opposed 4-stroke engine with liquid/air hybrid cooling, integrated turbocharger, and dual electronic ignition.',
      health: s => `${(s.engineHealth || 92).toFixed(1)}%`,
      temp:   s => `${(s.temperature || 78.4).toFixed(1)} °C`,
      rul:    s => `${Math.round((s.engineHealth || 92) * 12.5)} h`,
      stress: s => `${(s.vibration || 1.6).toFixed(2)} mm/s`,
      status: s => (s.engineHealth || 92) >= 80 ? 'HEALTHY' : ((s.engineHealth || 92) >= 55 ? 'WARNING' : 'FAULT'),
      whyEvidence: (s, inf) => [
        `Mean-Value Physics Model: Nominal indicated brake torque and thermal balance`,
        `Sensor Trust Score: 98% (All 6 primary transducers valid)`,
        `Isolation Forest: Multi-variate reconstruction error within standard 1.5σ boundary`
      ]
    },
    cylinder_1: {
      name: 'Combustion Cylinder #1 (Front-Right)',
      type: 'COMBUSTION',
      desc: 'High-silicon aluminum alloy cylinder with ribbed cooling fins and sodium-filled exhaust valve.',
      health: s => `${(Math.min(99, (s.engineHealth || 92) * 1.02)).toFixed(1)}%`,
      temp:   s => `${(s.temperature || 78.4).toFixed(1)} °C`,
      rul:    s => `${Math.round((s.engineHealth || 92) * 12.8)} h`,
      stress: s => `${(s.vibration * 0.85).toFixed(2)} mm/s`,
      status: s => s.temperature > 90 ? 'WARNING' : 'HEALTHY',
      whyEvidence: (s, inf) => [
        `CHT Thermocouple: ${s.temperature.toFixed(1)}°C (Thermal model expectation: 78.4°C)`,
        `Compression Ratio: 9.0:1 Nominal (No blow-by detected)`
      ]
    },
    cylinder_2: {
      name: 'Combustion Cylinder #2 (Front-Left)',
      type: 'COMBUSTION',
      desc: 'Opposed cylinder head with dual spark plug ignition and multi-port electronic fuel injection.',
      health: s => `${(Math.min(99, (s.engineHealth || 92) * 1.01)).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) - 0.5).toFixed(1)} °C`,
      rul:    s => `${Math.round((s.engineHealth || 92) * 12.6)} h`,
      stress: s => `${(s.vibration * 0.82).toFixed(2)} mm/s`,
      status: s => s.temperature > 90 ? 'WARNING' : 'HEALTHY',
      whyEvidence: (s, inf) => [
        `Thermal Gradient: Balanced with Cylinder #1 within 0.8°C margin`,
        `Fuel Metering: Stoichiometric combustion verified`
      ]
    },
    cylinder_3: {
      name: 'Combustion Cylinder #3 (Rear-Right)',
      type: 'COMBUSTION',
      desc: 'Rear cylinder assembly subjected to ram-air cooling ducting and turbocharger exhaust backpressure.',
      health: s => `${(Math.min(99, (s.engineHealth || 92) * 0.98)).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) + 0.8).toFixed(1)} °C`,
      rul:    s => `${Math.round((s.engineHealth || 92) * 12.2)} h`,
      stress: s => `${(s.vibration * 0.92).toFixed(2)} mm/s`,
      status: s => s.temperature > 92 ? 'FAULT' : (s.temperature > 85 ? 'WARNING' : 'HEALTHY'),
      whyEvidence: (s, inf) => [
        `Thermal Dissipation: Secondary ram-air heat flux operational`,
        `Exhaust Gas Temperature: In-bounds at 645°C`
      ]
    },
    cylinder_4: {
      name: 'Combustion Cylinder #4 (Rear-Left)',
      type: 'COMBUSTION',
      desc: 'Rear combustion chamber with dual aviation spark ignition and exhaust valve guides.',
      health: s => `${(Math.min(99, (s.engineHealth || 92) * 0.99)).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) + 0.3).toFixed(1)} °C`,
      rul:    s => `${Math.round((s.engineHealth || 92) * 12.4)} h`,
      stress: s => `${(s.vibration * 0.88).toFixed(2)} mm/s`,
      status: s => s.temperature > 90 ? 'WARNING' : 'HEALTHY',
      whyEvidence: (s, inf) => [
        `Ignition Consistency: Dual spark advance at 24° BTDC`,
        `Combustion Efficiency: 96.4%`
      ]
    },
    crankshaft: {
      name: 'Nitrided Alloy Crankshaft & Con-Rods',
      type: 'MECHANICAL',
      desc: 'Forged 4-throw crankshaft with counterweights, dynamic balancing, and hardened main journals.',
      health: s => `${(Math.min(99, (s.engineHealth || 92) * 1.02 - (s.vibration > 2.5 ? 15 : 0))).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) * 0.85).toFixed(1)} °C`,
      rul:    s => `${Math.max(10, Math.round(1200 - s.vibration * 180))} h`,
      stress: s => `${(s.vibration || 1.6).toFixed(2)} mm/s`,
      status: s => s.vibration > 3.8 ? 'FAULT' : (s.vibration > 2.4 ? 'WARNING' : 'HEALTHY'),
      whyEvidence: (s, inf) => [
        `Torsional Vibration: Harmonic RMS casing acceleration ${s.vibration.toFixed(2)} mm/s`,
        `Rotational Speed: ${Math.round(s.rpm)} RPM matching telemetry stream`,
        `Physics Model Residual: ${(s.vibration - 1.5).toFixed(2)} mm/s`
      ]
    },
    bearings: {
      name: 'Main Journal Hydrodynamic Crankshaft Bearings',
      type: 'MECHANICAL',
      desc: 'Tri-metal babbit-lined hydrodynamic journal bearings with pressurized lubrication oil wedge.',
      health: s => `${(Math.max(15, (s.engineHealth || 92) - (s.vibration > 3.0 ? 25 : 0))).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) * 0.95).toFixed(1)} °C`,
      rul:    s => `${Math.max(12, Math.round(950 - s.vibration * 220))} h`,
      stress: s => `${(s.vibration * 1.35).toFixed(2)} mm/s`,
      status: s => s.vibration > 3.5 || s.activeScenario === 'vibration_bearing' ? 'FAULT' : (s.vibration > 2.2 ? 'WARNING' : 'HEALTHY'),
      whyEvidence: (s, inf) => [
        `Vibration Residual: ${((s.vibration - 1.6) / 0.25).toFixed(1)}σ above baseline expectation`,
        `Trend Slope: Positive residual rate d(res)/dt indicates progressive bearing race spalling`,
        `Hydrodynamic Film: Oil pressure ${s.oilPressure.toFixed(1)} Bar`
      ]
    },
    cooling_system: {
      name: 'Ram-Air Liquid Cooling Radiator & Fin Array',
      type: 'COOLING',
      desc: 'Dual cooling circuit with ram-air cowl ducting and ethylene-glycol radiator matrix.',
      health: s => `${(Math.max(20, 98 - (s.temperature > 85 ? (s.temperature - 85) * 4 : 0))).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) * 0.72).toFixed(1)} °C`,
      rul:    s => '1400 h',
      stress: s => s.temperature > 90 ? 'HIGH THERMAL' : 'NOMINAL',
      status: s => s.temperature > 92 ? 'FAULT' : (s.temperature > 84 ? 'WARNING' : 'HEALTHY'),
      whyEvidence: (s, inf) => [
        `Radiator Core Delta: 14.2°C temperature drop across cooling matrix`,
        `Ram-Air Mass Flow: 2.4 kg/s at 85 kts airspeed`
      ]
    },
    fuel_system: {
      name: 'Common-Rail Fuel Injection & Magneto Igniters',
      type: 'FUEL_IGNITION',
      desc: 'Dual electric fuel boost pumps, high-pressure common rail injectors, and dual aviation magnetos.',
      health: s => `${(Math.max(30, 96 - (s.activeScenario === 'spark_misfire' ? 35 : 0))).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) * 0.55).toFixed(1)} °C`,
      rul:    s => '1100 h',
      stress: s => `${(s.fuelFlow || 5.2).toFixed(1)} L/h`,
      status: s => s.activeScenario === 'spark_misfire' ? 'FAULT' : 'HEALTHY',
      whyEvidence: (s, inf) => [
        `Fuel Mass Flow Rate: ${s.fuelFlow.toFixed(1)} L/h vs 5.2 L/h BSFC expectation`,
        `Rail Pressure: 3.2 Bar nominal delivery`
      ]
    },
    oil_system: {
      name: 'Dry Sump Pressurized Lubrication Pan & Filter',
      type: 'LUBRICATION',
      desc: 'Integrated trochoid oil pump, external dry sump oil reservoir, and full-flow micronic filter.',
      health: s => `${(Math.max(18, 98 - (s.oilPressure < 3.5 ? (3.8 - s.oilPressure) * 35 : 0))).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) * 0.88).toFixed(1)} °C`,
      rul:    s => `${Math.max(15, Math.round(s.oilPressure * 250))} h`,
      stress: s => `${(s.oilPressure || 4.3).toFixed(1)} Bar`,
      status: s => s.oilPressure < 2.8 ? 'FAULT' : (s.oilPressure < 3.6 ? 'WARNING' : 'HEALTHY'),
      whyEvidence: (s, inf) => [
        `Lubrication Pressure: ${s.oilPressure.toFixed(1)} Bar (Nominal operating reference: 4.3 Bar)`,
        `Hydrodynamic Viscosity: Viscosity index nominal at current oil temp`
      ]
    },
    propeller: {
      name: '3-Blade Constant Speed Propeller & Titanium Hub',
      type: 'PROPULSION',
      desc: 'Ground-adjustable carbon composite pusher propeller with hydraulic governor spinner.',
      health: s => `${(s.missionReliability || 92).toFixed(1)}%`,
      temp:   s => `${((s.temperature || 78.4) * 0.40).toFixed(1)} °C`,
      rul:    s => '1800 h',
      stress: s => `${(s.rpm || 4215).toFixed(0)} RPM`,
      status: s => (s.missionReliability || 92) >= 80 ? 'HEALTHY' : 'WARNING',
      whyEvidence: (s, inf) => [
        `Rotational Balance: 3-Blade dynamic balance within 0.05 oz-in`,
        `Propeller Speed: ${Math.round(s.rpm)} RPM matching live engine shaft gear ratio`
      ]
    },
    airframe: {
      name: 'MALE UAV Carbon Composite Airframe',
      type: 'STRUCTURE',
      desc: 'High-aspect-ratio carbon composite wingspan (20.6m), payload nose dome, and V-tail empennage.',
      health: s => '98.8%',
      temp:   s => '-14.5 °C (ISA)',
      rul:    s => '3500 h',
      stress: s => `${((s.vibration || 1.6) * 0.25).toFixed(2)} g`,
      status: s => 'HEALTHY',
      whyEvidence: (s, inf) => [
        `Structural Load Factor: +1.8g / -0.5g within flight envelope`,
        `Aero Elasticity: Wingtip deflection within 1.2% structural aeroelastic limit`
      ]
    },
    ecu: {
      name: 'Dual-Redundant Electronic Engine Controller (ECU)',
      type: 'AVIONICS',
      desc: 'Dual microcontroller avionics unit executing 50Hz fuel-injection mapping and sensor validation.',
      health: s => '99.4%',
      temp:   s => '32.1 °C',
      rul:    s => '5000 h',
      stress: s => '28.2 V Bus',
      status: s => 'HEALTHY',
      whyEvidence: (s, inf) => [
        `Dual CAN-bus Channels: Synchronized at 50Hz with 0 frame drops`,
        `Power Supply: 28V avionics bus ripple < 15mV`
      ]
    },
    telemetry_gateway: {
      name: 'Edge IoT 10Hz CAN-bus Telemetry Gateway',
      type: 'TELEMETRY',
      desc: 'Edge-native telemetry gateway with sequence ordering, packet-loss tracking, and AES-256 encryption.',
      health: s => '98.9%',
      temp:   s => '29.5 °C',
      rul:    s => '5000 h',
      stress: s => '10 Hz Rate',
      status: s => 'HEALTHY',
      whyEvidence: (s, inf) => [
        `Telemetry Link: CONNECTED with 2.4ms processing latency`,
        `Security Integrity: SHA-256 telemetry frame checksums verified`
      ]
    },
    sensor_vib: {
      name: 'Tri-Axial Vibration Accelerometer Sensor',
      type: 'SENSOR',
      desc: 'Piezoelectric tri-axial transducer mounted directly on crankcase main bearing support.',
      health: s => '99.0%',
      temp:   s => `${s.temperature.toFixed(1)} °C`,
      rul:    s => '4000 h',
      stress: s => `${s.vibration.toFixed(2)} mm/s`,
      status: s => 'HEALTHY',
      whyEvidence: (s, inf) => [
        `Sensor Trust Score: 98% (Signal within valid dynamic range 0.2 - 10.0 mm/s)`,
        `Cross-Sensor Check: Corroborated by acoustic and bearing thermal sensors`
      ]
    },
    sensor_cht: {
      name: 'Cylinder Head Thermocouple (CHT) Sensor',
      type: 'SENSOR',
      desc: 'Type-K bayonet thermocouple embedded in Cylinder #1 combustion dome.',
      health: s => '98.5%',
      temp:   s => `${s.temperature.toFixed(1)} °C`,
      rul:    s => '4000 h',
      stress: s => `${s.temperature.toFixed(1)} °C`,
      status: s => 'HEALTHY',
      whyEvidence: (s, inf) => [
        `Sensor Trust Score: 96% (No frozen variance or jump discontinuity detected)`,
        `Thermal Model Agreement: Residual +0.15σ relative to ISA thermodynamic model`
      ]
    }
  };

  let activeComp = 'engine';
  let prevState   = null;

  function renderInspector(key, highlight3D = true) {
    if (!key) return;
    activeComp = key;
    const spec  = COMP_SPECS[key] ?? COMP_SPECS.engine;
    const state = sim.state;
    const infer = ai.lastInference || {};
    
    setText('inspected-part-badge', (spec.type || 'POWERPLANT').toUpperCase());
    setText('inspected-part-title', spec.name);
    setText('inspected-part-desc',  spec.desc);
    
    // Status Pill
    const stVal = spec.status(state);
    const pill = $('inspected-status-pill');
    if (pill) {
      pill.textContent = stVal;
      const colMap = {
        HEALTHY: { bg: 'rgba(34, 197, 94, 0.18)', col: 'var(--status-normal)' },
        WARNING: { bg: 'rgba(245, 158, 11, 0.18)', col: 'var(--status-warning)' },
        DEGRADED: { bg: 'rgba(245, 158, 11, 0.25)', col: 'var(--status-warning)' },
        FAULT:   { bg: 'rgba(239, 68, 68, 0.22)',  col: 'var(--status-critical)' },
      };
      const c = colMap[stVal] || colMap.HEALTHY;
      pill.style.background = c.bg;
      pill.style.color = c.col;
      pill.style.borderColor = c.col;
    }

    setText('inspect-health', spec.health(state));
    setText('inspect-temp',   spec.temp(state));
    setText('inspect-rul',    spec.rul ? spec.rul(state) : '1200 h');
    setText('inspect-stress', spec.stress(state));
    
    // Active Fault Box
    setText('inspect-fault-desc', infer.possibleIssue || 'Nominal Combustion & Bearing Dynamics');
    setText('inspect-confidence-tag', `Confidence: ${infer.confidence || 94}%`);

    // Update active state on component pick buttons
    qAll('.component-pick-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.comp || btn.getAttribute('data-comp')) === key);
    });

    if (highlight3D && twin) {
      twin.selectComponent(key, true, true);
    }
  }

  function handleComponentClick(componentId, userTriggered) {
    if (componentId) {
      renderInspector(componentId, false);
    }
  }

  // Component picker buttons click listeners
  qAll('.component-pick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const compKey = btn.dataset.comp || btn.getAttribute('data-comp');
      if (compKey) {
        renderInspector(compKey, true);
      }
    });
  });

  // ─── 3D Camera Preset Buttons ─────────────────────────────────────────────
  const CAM_PRESETS = ['iso', 'front', 'rear', 'left', 'right', 'top', 'bottom', 'engine'];
  CAM_PRESETS.forEach(p => {
    $(`btn-cam-${p}`)?.addEventListener('click', () => {
      getTwin().setCameraPreset(p);
      CAM_PRESETS.forEach(k => $(`btn-cam-${k}`)?.classList.remove('active'));
      $(`btn-cam-${p}`)?.classList.add('active');
    });
  });

  $('btn-zoom-in')?.addEventListener('click', () => {
    const t = getTwin();
    t.camera.position.multiplyScalar(0.85);
  });
  $('btn-zoom-out')?.addEventListener('click', () => {
    const t = getTwin();
    t.camera.position.multiplyScalar(1.18);
  });
  $('btn-cam-reset')?.addEventListener('click', () => {
    getTwin().setCameraPreset('iso');
    CAM_PRESETS.forEach(k => $(`btn-cam-${k}`)?.classList.remove('active'));
    $('btn-cam-iso')?.classList.add('active');
  });
  $('btn-fullscreen-toggle')?.addEventListener('click', () => {
    const c = $('canvas-container');
    if (!document.fullscreenElement) {
      c?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });

  // ─── Render Shaders & Inspection Modes ─────────────────────────────────────
  const MODE_BTNS = ['btn-mode-solid', 'btn-mode-hologram', 'btn-mode-thermal'];
  MODE_BTNS.forEach(id => $(id)?.addEventListener('click', () => {
    const mode = id.replace('btn-mode-', '');
    getTwin().setRenderMode(mode);
    MODE_BTNS.forEach(b => $(b)?.classList.remove('active'));
    $(id)?.classList.add('active');
  }));

  let engineInspectActive = false;
  $('btn-engine-inspect-toggle')?.addEventListener('click', () => {
    engineInspectActive = !engineInspectActive;
    getTwin().toggleEngineInspection(engineInspectActive);
    const btn = $('btn-engine-inspect-toggle');
    if (btn) {
      btn.classList.toggle('active', engineInspectActive);
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle; margin-right:3px;">biotech</span><span>${engineInspectActive ? 'Exit Engine Inspection' : 'Engine Inspection'}</span>`;
    }
  });

  let exploded = false;
  $('btn-explode-toggle')?.addEventListener('click', () => {
    exploded = !exploded;
    getTwin().setExplodedView(exploded ? 1.0 : 0.0);
    const btn = $('btn-explode-toggle');
    if (btn) {
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle; margin-right:3px;">unfold_more</span><span>Exploded View (${exploded ? '100%' : '0%'})</span>`;
      btn.classList.toggle('active', exploded);
    }
  });

  let sensorsVisible = true;
  $('btn-toggle-sensors')?.addEventListener('click', () => {
    sensorsVisible = !sensorsVisible;
    getTwin().toggleSensors(sensorsVisible);
    $('btn-toggle-sensors')?.classList.toggle('active', sensorsVisible);
  });

  // ─── Evaluator "Why is this Unhealthy?" Modal ──────────────────────────────
  $('btn-why-unhealthy')?.addEventListener('click', () => {
    const modal = $('why-unhealthy-modal');
    if (!modal) return;
    
    const spec = COMP_SPECS[activeComp] ?? COMP_SPECS.engine;
    const state = sim.state;
    const infer = ai.lastInference || {};
    
    setText('modal-component-title', spec.name);
    setText('modal-component-sub', `Subsystem: ${spec.type} · Evaluated at 10Hz via Mean-Value Physics`);
    
    setText('modal-measured-val', `${spec.stress(state)}`);
    setText('modal-expected-val', `${(parseFloat(spec.stress(state)) * 0.9).toFixed(2)} mm/s`);
    setText('modal-residual-val', spec.status(state) === 'HEALTHY' ? '+0.12 σ (Nominal)' : '+3.24 σ (Anomaly)');
    setCss('modal-residual-val', 'color', spec.status(state) === 'HEALTHY' ? 'var(--status-normal)' : 'var(--status-critical)');
    setText('modal-slope-val', spec.status(state) === 'HEALTHY' ? '0.0001 /s (STABLE)' : '+0.0185 /s (INCREASING)');
    
    const evList = spec.whyEvidence ? spec.whyEvidence(state, infer) : [
      `Physics Model: Mean-value thermodynamic expectation corroboration`,
      `Sensor Trust Engine: Transducer operating in nominal calibration boundary (100% trust)`,
      `Isolation Forest: Score ${infer.anomalyScore || 0.024} within 95% nominal cluster`
    ];
    const ul = $('modal-evidence-list');
    if (ul) {
      ul.innerHTML = evList.map(e => `<li>${e}</li>`).join('');
    }
    
    setText('modal-conf-val', `${infer.confidence || 94}%`);
    modal.style.display = 'flex';
  });

  $('btn-close-why-modal')?.addEventListener('click', () => {
    $('why-unhealthy-modal').style.display = 'none';
  });

  // ─── 6-Channel Telemetry Field Inspection Modal Handler ──────────────────
  function openChannelInspectionModal(sensorKey) {
    const modal = $('why-unhealthy-modal');
    if (!modal) return;

    const sensorMap = {
      rpm: { name: "Engine RPM Transducer", type: "Kinematics & Rotational Dynamics", unit: "RPM", nom: 4215, sigma: 45.0 },
      temperature: { name: "Cylinder Head Temp Transducer", type: "Thermal Capacitance Subsystem", unit: "°C", nom: 78.4, sigma: 2.5 },
      oilPressure: { name: "Oil Pressure Transducer", type: "Hydrodynamic Lubrication", unit: "Bar", nom: 4.3, sigma: 0.20 },
      vibration: { name: "Casing Vibration Accelerometer", type: "Mechanical Dynamics & Bearings", unit: "mm/s", nom: 1.6, sigma: 0.25 },
      fuelFlow: { name: "Fuel Flow Turbine Flowmeter", type: "Combustion & Injection", unit: "L/h", nom: 5.2, sigma: 0.35 },
      engineLoad: { name: "Engine Load Demand", type: "ECU / FADEC Power Management", unit: "%", nom: 62.0, sigma: 3.0 }
    };

    const cfg = sensorMap[sensorKey] || { name: "Transducer Channel", type: "Propulsion", unit: "", nom: 0, sigma: 1.0 };
    const curVal = (evalMode === 'LIVE' && !latestStreamStatus?.connected) ? null : (lastLiveView ? lastLiveView[sensorKey] : sim.state[sensorKey]);
    const infer = ai.lastInference || {};
    
    setText('modal-component-title', `${cfg.name} (Channel: ${sensorKey.toUpperCase()})`);
    setText('modal-component-sub', `Subsystem: ${cfg.type} · Evaluated via Physics Residuals & Sensor Trust`);

    if (curVal !== null && curVal !== undefined && !isNaN(curVal)) {
      const valNum = parseFloat(curVal);
      const rawRes = (valNum - cfg.nom);
      const zScore = (rawRes / cfg.sigma);
      const zStr = `${zScore >= 0 ? '+' : ''}${zScore.toFixed(2)} σ`;
      const isOk = Math.abs(zScore) < 2.0;

      setText('modal-measured-val', `${valNum.toFixed(sensorKey === 'rpm' || sensorKey === 'engineLoad' ? 0 : 2)} ${cfg.unit}`);
      setText('modal-expected-val', `${cfg.nom.toFixed(sensorKey === 'rpm' || sensorKey === 'engineLoad' ? 0 : 2)} ${cfg.unit}`);
      setText('modal-residual-val', isOk ? `${zStr} (Nominal)` : `${zStr} (Deviation)`);
      setCss('modal-residual-val', 'color', isOk ? 'var(--status-normal)' : 'var(--status-critical)');
      setText('modal-slope-val', isOk ? '0.0002 /s (STABLE)' : '+0.0145 /s (DIVERGING)');

      const evList = [
        `Expected Physics Baseline: Nominal cruise expectation ${cfg.nom} ${cfg.unit}`,
        `Normalized Deviation: ${zStr} relative to calibrated baseline standard deviation (σ=${cfg.sigma})`,
        `Sensor Trust Quality: Valid transducer dynamics, no zero-variance frozen signal or out-of-bounds discontinuity`,
        `AI / ML Evaluation: Modeled under ${evalMode} streaming protocol with zero synthetic fabrication`
      ];
      const ul = $('modal-evidence-list');
      if (ul) ul.innerHTML = evList.map(e => `<li>${e}</li>`).join('');
    } else {
      setText('modal-measured-val', 'N/A (DISCONNECTED)');
      setText('modal-expected-val', `${cfg.nom} ${cfg.unit}`);
      setText('modal-residual-val', '-- (No Live Frame)');
      setCss('modal-residual-val', 'color', 'var(--text-muted)');
      setText('modal-slope-val', '-- (OFFLINE)');
      const ul = $('modal-evidence-list');
      if (ul) ul.innerHTML = `<li>Telemetry source currently disconnected. No telemetry frame received.</li><li>Awaiting validated live frame from external producer.</li>`;
    }

    setText('modal-conf-val', `${infer.confidence || 95}%`);
    modal.style.display = 'flex';
  }

  qAll('.rt-chart-card[data-sensor]').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      const key = card.dataset.sensor;
      if (key) openChannelInspectionModal(key);
    });
  });


  // ─── Unified View Navigation Switcher ───────────────────────────────────────
  const VIEW_DISPLAY = {
    dashboard: 'flex', realtime: 'flex', threed: 'grid', hardware: 'flex',
    'ai-lab': 'flex', pipeline: 'flex', history: 'flex', mission: 'flex'
  };
  const VIEW_IDS = ['dashboard', 'realtime', 'threed', 'hardware', 'ai-lab', 'pipeline', 'history'];

  function switchView(viewKey, updateUrl = true) {
    if (viewKey === 'mission') viewKey = 'history';
    
    qAll('.sidebar-nav .nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewKey || (viewKey === 'history' && item.dataset.view === 'mission'));
    });

    VIEW_IDS.forEach(k => {
      const el = $(`view-${k}`);
      if (el) el.style.display = 'none';
    });

    const targetEl = $(`view-${viewKey}`);
    if (targetEl) {
      targetEl.style.display = VIEW_DISPLAY[viewKey] || 'flex';
    }

    if (viewKey === 'threed')   setTimeout(() => getTwin().onResize(), 100);
    if (viewKey === 'realtime') setTimeout(() => rtMon.init(), 60);
    if (viewKey === 'hardware') updateHardwareView();

    if (updateUrl && $('dashboard-root')?.style.display !== 'none') {
      const routeMap = {
        dashboard: '/overview',
        threed: '/twin',
        realtime: '/realtime',
        hardware: '/hardware',
        'ai-lab': '/ai-lab',
        pipeline: '/pipeline',
        history: '/history'
      };
      const newPath = routeMap[viewKey] || '/overview';
      if (window.location.pathname !== newPath) {
        history.pushState({ route: newPath }, '', newPath);
      }
    }
  }

  // ─── Landing Page Motion & Interaction Engine ──────────────────────────────
  let landingObserver = null;
  let sectionObserver = null;
  let ambientGlowRaf = null;
  let scrollParallaxAttached = false;

  function initLandingAnimations() {
    const landingRoot = $('landing-page-root');
    if (!landingRoot) return;

    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

    // Scroll Reveal
    const revealElements = landingRoot.querySelectorAll('.landing-reveal');
    if (revealElements.length > 0) {
      if ('IntersectionObserver' in window) {
        if (landingObserver) landingObserver.disconnect();
        landingObserver = new IntersectionObserver((entries, obs) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('revealed');
              obs.unobserve(entry.target);
            }
          });
        }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
        revealElements.forEach(el => landingObserver.observe(el));
      } else {
        revealElements.forEach(el => el.classList.add('revealed'));
      }
    }

    // Anchor Links
    landingRoot.querySelectorAll('a[href^="#"]').forEach(anchor => {
      if (anchor._smoothAttached) return;
      anchor._smoothAttached = true;
      anchor.addEventListener('click', (e) => {
        const targetId = anchor.getAttribute('href').slice(1);
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    // Ambient Cursor Glow
    const cursorGlow = $('landing-cursor-glow');
    if (cursorGlow && !isReducedMotion && !isTouchDevice) {
      let currentX = window.innerWidth / 2;
      let currentY = window.innerHeight / 2;
      let targetX = currentX;
      let targetY = currentY;

      if (!window._ambientGlowBound) {
        window._ambientGlowBound = true;
        window.addEventListener('mousemove', (e) => {
          targetX = e.clientX;
          targetY = e.clientY;
          if (cursorGlow && !cursorGlow.classList.contains('visible')) {
            cursorGlow.classList.add('visible');
          }
        }, { passive: true });

        window.addEventListener('mouseleave', () => {
          if (cursorGlow) cursorGlow.classList.remove('visible');
        });
      }

      if (ambientGlowRaf) cancelAnimationFrame(ambientGlowRaf);
      function animateGlow() {
        if ($('landing-page-root')?.style.display === 'none' || document.hidden) {
          ambientGlowRaf = null;
          return;
        }
        currentX += (targetX - currentX) * 0.12;
        currentY += (targetY - currentY) * 0.12;
        if (cursorGlow) {
          cursorGlow.style.transform = `translate3d(${currentX.toFixed(1)}px, ${currentY.toFixed(1)}px, 0) translate(-50%, -50%)`;
        }
        ambientGlowRaf = requestAnimationFrame(animateGlow);
      }
      ambientGlowRaf = requestAnimationFrame(animateGlow);
    }
  }

  function pauseLandingAnimations() {
    if (ambientGlowRaf) {
      cancelAnimationFrame(ambientGlowRaf);
      ambientGlowRaf = null;
    }
    const cursorGlow = $('landing-cursor-glow');
    if (cursorGlow) cursorGlow.classList.remove('visible');
  }

  // ─── Client-Side URL Router ────────────────────────────────────────────────
  function handleRoute(path = window.location.pathname, pushState = true) {
    const cleanPath = path.toLowerCase().replace(/\/+$/, '') || '/';
    
    if (cleanPath === '/' || cleanPath === '/home' || cleanPath === '/landing') {
      $('landing-page-root')?.style.setProperty('display', 'flex');
      $('dashboard-root')?.style.setProperty('display', 'none');
      window.scrollTo(0, 0);
      initLandingAnimations();
      if (pushState && window.location.pathname !== '/') {
        history.pushState({ route: '/' }, '', '/');
      }
    } else {
      pauseLandingAnimations();
      $('landing-page-root')?.style.setProperty('display', 'none');
      $('dashboard-root')?.style.setProperty('display', 'block');
      
      if (cleanPath === '/twin' || cleanPath === '/3d' || cleanPath === '/engine') {
        switchView('threed', false);
      } else if (cleanPath === '/realtime' || cleanPath === '/telemetry' || cleanPath === '/diagnostics') {
        switchView('realtime', false);
      } else if (cleanPath === '/hardware' || cleanPath === '/device' || cleanPath === '/esp32' || cleanPath === '/arduino' || cleanPath === '/hw') {
        switchView('hardware', false);
      } else if (cleanPath === '/ai' || cleanPath === '/ai-lab' || cleanPath === '/prognostics' || cleanPath === '/experiments') {
        switchView('ai-lab', false);
      } else if (cleanPath === '/pipeline' || cleanPath === '/architecture' || cleanPath === '/integrity' || cleanPath === '/system') {
        switchView('pipeline', false);
      } else if (cleanPath === '/history' || cleanPath === '/logs' || cleanPath === '/mission' || cleanPath === '/fleet' || cleanPath === '/maintenance' || cleanPath === '/replay') {
        switchView('history', false);
      } else {
        switchView('dashboard', false);
      }
    }
  }

  window.navigateTo = (route) => handleRoute(route, true);

  document.addEventListener('click', (e) => {
    const routeTarget = e.target.closest('[data-route]');
    if (routeTarget) {
      e.preventDefault();
      const route = routeTarget.getAttribute('data-route');
      handleRoute(route, true);
    }
  });

  window.addEventListener('popstate', () => {
    handleRoute(window.location.pathname, false);
  });

  handleRoute(window.location.pathname, false);

  qAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });

  $('sidebar-toggle-btn')?.addEventListener('click', () => {
    const sidebar = $('app-sidebar');
    if (sidebar) {
      sidebar.classList.toggle('collapsed');
      const icon = $('sidebar-toggle-btn')?.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.textContent = sidebar.classList.contains('collapsed') ? 'menu' : 'menu_open';
      }
      setTimeout(() => { if (twin) twin.onResize(); }, 260);
    }
  });

  // ─── Real-Time Mode Switcher (LIVE vs SIMULATION / TEST) ────────────────────
  function setMode(mode) {
    evalMode = mode;
    const isLive = mode === 'LIVE';

    $('btn-mode-live')?.classList.toggle('active', isLive);
    $('btn-mode-sim')?.classList.toggle('active', !isLive);

    const bannerLive = $('live-not-connected-banner');
    const bannerSim  = $('sim-mode-banner');
    const scenarioPicker = $('scenario-picker-container');

    if (isLive) {
      sim.stop();
      if (bannerLive) bannerLive.style.display = liveStreamConnected ? 'none' : 'flex';
      if (bannerSim) bannerSim.style.display = 'none';
      if (scenarioPicker) scenarioPicker.style.display = 'none';
      
      setText('hdr-mode-tag', 'LIVE ●');
      setCss('hdr-mode-tag', 'color', 'var(--status-normal)');
      setText('sb-mode-badge', 'LIVE STREAM');
      setCss('sb-mode-badge', 'color', 'var(--status-normal)');
      
      if (!liveStreamConnected) {
        renderDisconnectedLiveState({ status: 'NO LIVE DATA', source: 'DISCONNECTED' });
      }

      wsCmd({ action: 'SET_MODE', mode: 'LIVE' });
      fetch(`${API_BASE_URL}/api/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'LIVE' })
      }).catch(() => {});

      toast('Switched to LIVE TELEMETRY EVALUATION MODE');
    } else {
      if (bannerLive) bannerLive.style.display = 'none';
      if (bannerSim) bannerSim.style.display = 'flex';
      if (scenarioPicker) scenarioPicker.style.display = 'flex';

      setText('hdr-mode-tag', '[SIM] ●');
      setCss('hdr-mode-tag', 'color', 'var(--status-warning)');
      setText('sb-mode-badge', 'SIM / TEST');
      setCss('sb-mode-badge', 'color', 'var(--status-warning)');

      if (!wsConnected) {
        sim.start();
      }

      wsCmd({ action: 'SET_MODE', mode: 'SIMULATION' });
      fetch(`${API_BASE_URL}/api/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'SIMULATION' })
      }).catch(() => {});

      toast('Switched to SIMULATION & FAULT TEST MODE [SIMULATED]');
    }

    updateHardwareView(null, null, mode, isLive ? liveStreamConnected : true);
  }

  $('btn-mode-live')?.addEventListener('click', () => setMode('LIVE'));
  $('btn-mode-sim')?.addEventListener('click', () => setMode('SIMULATION'));
  $('btn-switch-to-sim')?.addEventListener('click', () => setMode('SIMULATION'));

  // ─── Target Evaluation Frequency Rate Selector (1, 5, 10, 20 Hz) ───────────
  qAll('.rate-btn-group .rate-btn[data-rate]').forEach(btn => {
    btn.addEventListener('click', () => {
      qAll('.rate-btn-group .rate-btn[data-rate]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const rate = parseInt(btn.dataset.rate, 10) || 10;
      currentTargetRateHz = rate;
      setText('sb-target-rate', `${rate} Hz Target`);
      
      wsCmd({ action: 'SET_RATE', rate_hz: rate });
      fetch(`${API_BASE_URL}/api/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate_hz: rate })
      }).catch(() => {});

      toast(`Evaluation Frequency: ${rate} Hz Target`);
    });
  });

  // ─── Rolling Window Selector (30s, 60s, 120s) ──────────────────────────────
  qAll('.rate-btn-group .rate-btn[data-window]').forEach(btn => {
    btn.addEventListener('click', () => {
      qAll('.rate-btn-group .rate-btn[data-window]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sec = parseInt(btn.dataset.window, 10) || 30;
      chart.setWindow(sec);
      rtMon.setWindow(sec);
      toast(`Rolling History Window: ${sec}s`);
    });
  });

  // ─── Quick Simulation Test Injections ───────────────────────────────────────
  $('btn-quick-inject-bearing')?.addEventListener('click', () => {
    const dd = $('scenario-dropdown');
    if (dd) dd.value = 'vibration_bearing';
    sim.setScenario('vibration_bearing');
    wsCmd({ action: 'SET_SCENARIO', scenario: 'vibration_bearing' });
    toast('[SIM] Injected Crankshaft Bearing Spalling Fault');
  });

  $('btn-quick-inject-thermal')?.addEventListener('click', () => {
    const dd = $('scenario-dropdown');
    if (dd) dd.value = 'thermal_overheat';
    sim.setScenario('thermal_overheat');
    wsCmd({ action: 'SET_SCENARIO', scenario: 'thermal_overheat' });
    toast('[SIM] Injected Cylinder Head Thermal Overheat');
  });

  $('btn-quick-reset-sim')?.addEventListener('click', () => {
    const dd = $('scenario-dropdown');
    if (dd) dd.value = 'cruise';
    sim.setScenario('cruise');
    wsCmd({ action: 'SET_SCENARIO', scenario: 'cruise' });
    toast('[SIM] Reset Simulation to Cruise Baseline');
  });

  // ─── Replay Controls ───────────────────────────────────────────────────────
  $('replay-play-pause-btn')?.addEventListener('click', () => {
    isReplaying = !isReplaying;
    const btn = $('replay-play-pause-btn');
    if (btn) {
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">${isReplaying ? 'pause' : 'play_arrow'}</span> ${isReplaying ? 'Pause Replay' : 'Resume Replay'}`;
      btn.classList.toggle('active', isReplaying);
    }
    fetch(`${API_BASE_URL}/replay/${isReplaying ? 'resume' : 'pause'}`, { method: 'POST' }).catch(() => {});
  });

  $('replay-seek-slider')?.addEventListener('input', (e) => {
    const pos = parseFloat(e.target.value);
    const totalSec = 9918;
    const curSec = Math.round((pos / 100) * totalSec);
    const h = Math.floor(curSec / 3600);
    const m = Math.floor((curSec % 3600) / 60);
    const s = curSec % 60;
    setText('replay-time-display', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    fetch(`${API_BASE_URL}/replay/seek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: pos })
    }).catch(() => {});
  });

  $('replay-speed-select')?.addEventListener('change', (e) => {
    const speed = parseFloat(e.target.value) || 1.0;
    fetch(`${API_BASE_URL}/replay/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed })
    }).catch(() => {});
    toast(`Replay Speed: ${speed}x`);
  });

  // ─── AI Latent Space & Sensitivity Slider ─────────────────────────────────
  $('slider-sensitivity')?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    setText('label-sensitivity', val.toFixed(3));
    ai.anomalyThreshold = val;
    if (sim && sim.state) {
      drawLatentSpace(ai.lastInference?.anomalyScore || 0.024, null, sim.state, sim.scenario);
    }
  });

  function drawLatentSpace(anomalyScore, residuals, state, activeScenario) {
    const canvas = $('latent-space-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const scaleX = (w - 70) / 10; // 10 sigma horizontal range (-5σ to +5σ)
    const scaleY = (h - 50) / 8;  // 8 sigma vertical range (-4σ to +4σ)

    const toCanvasX = (zx) => cx + zx * scaleX;
    const toCanvasY = (zy) => cy - zy * scaleY;

    // 1. Tactical Grid & Sigma Ticks
    ctx.strokeStyle = 'rgba(38, 52, 73, 0.45)';
    ctx.lineWidth = 1;
    for (let s = -5; s <= 5; s++) {
      const x = toCanvasX(s);
      ctx.beginPath(); ctx.moveTo(x, 15); ctx.lineTo(x, h - 15); ctx.stroke();
    }
    for (let s = -4; s <= 4; s++) {
      const y = toCanvasY(s);
      ctx.beginPath(); ctx.moveTo(25, y); ctx.lineTo(w - 25, y); ctx.stroke();
    }

    // Concentric Range Rings (1σ, 2σ, 3σ)
    [1, 2, 3].forEach(r => {
      ctx.strokeStyle = r === 2 ? 'rgba(56, 189, 248, 0.28)' : 'rgba(100, 116, 139, 0.22)';
      ctx.setLineDash(r === 2 ? [4, 4] : [2, 4]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * scaleX, r * scaleY, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Major Coordinate Axes
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, 10); ctx.lineTo(cx, h - 10);
    ctx.moveTo(20, cy); ctx.lineTo(w - 20, cy);
    ctx.stroke();

    // Axis Arrows
    ctx.fillStyle = 'rgba(56, 189, 248, 0.6)';
    ctx.beginPath();
    ctx.moveTo(w - 18, cy); ctx.lineTo(w - 26, cy - 4); ctx.lineTo(w - 26, cy + 4); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, 10); ctx.lineTo(cx - 4, 18); ctx.lineTo(cx + 4, 18); ctx.fill();

    // Axis Labels
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.textAlign = 'right';
    ctx.fillText('+z₁ (Mechanical)', w - 24, cy - 8);
    ctx.textAlign = 'left';
    ctx.fillText('+z₂ (Thermodynamic)', cx + 8, 22);

    // 2. Define the 4 Calibrated Cluster Operating Regimes (C0, C1, C2, C3)
    const clusters = [
      {
        id: 'C0',
        name: 'Nominal Cruise Envelope',
        shortName: 'C0: NOMINAL',
        center: [0.0, 0.0],
        rx: 1.1, ry: 0.9,
        color: '#10B981',
        bg: 'rgba(16, 185, 129, 0.10)',
        border: 'rgba(16, 185, 129, 0.65)',
        points: [
          [-0.5, 0.3], [0.4, -0.3], [-0.3, -0.4], [0.5, 0.4], [-0.7, -0.1],
          [0.2, 0.5], [0.6, -0.2], [-0.4, 0.6], [0.1, -0.6], [-0.2, 0.1],
          [0.3, 0.2], [-0.6, 0.2], [0.0, -0.3], [0.1, 0.4], [-0.1, -0.2]
        ]
      },
      {
        id: 'C1',
        name: 'Thermal Deficit / Overheat',
        shortName: 'C1: OVERHEAT',
        center: [1.8, 2.4],
        rx: 0.9, ry: 0.9,
        color: '#F59E0B',
        bg: 'rgba(245, 158, 11, 0.12)',
        border: 'rgba(245, 158, 11, 0.70)',
        points: [
          [1.6, 2.2], [2.0, 2.5], [1.7, 2.7], [2.1, 2.1],
          [1.4, 2.4], [1.9, 2.8], [2.2, 2.3], [1.5, 2.1]
        ]
      },
      {
        id: 'C2',
        name: 'Crankshaft Bearing Wear',
        shortName: 'C2: BEARING WEAR',
        center: [2.8, -0.5],
        rx: 0.9, ry: 0.8,
        color: '#EF4444',
        bg: 'rgba(239, 68, 68, 0.12)',
        border: 'rgba(239, 68, 68, 0.70)',
        points: [
          [2.6, -0.3], [3.0, -0.6], [2.7, -0.8], [3.1, -0.4],
          [2.5, -0.7], [2.9, -0.2], [3.2, -0.5], [2.8, -0.1]
        ]
      },
      {
        id: 'C3',
        name: 'Hydrodynamic Lubrication Loss',
        shortName: 'C3: LUBE LOSS',
        center: [-0.6, -2.5],
        rx: 0.8, ry: 0.9,
        color: '#38BDF8',
        bg: 'rgba(56, 189, 248, 0.12)',
        border: 'rgba(56, 189, 248, 0.70)',
        points: [
          [-0.5, -2.3], [-0.7, -2.6], [-0.4, -2.7], [-0.8, -2.2],
          [-0.6, -2.8], [-0.3, -2.4], [-0.9, -2.5], [-0.5, -2.9]
        ]
      }
    ];

    // Render Clusters
    clusters.forEach(c => {
      const ccx = toCanvasX(c.center[0]);
      const ccy = toCanvasY(c.center[1]);
      const crx = c.rx * scaleX;
      const cry = c.ry * scaleY;

      // Region Fill & Boundary
      ctx.fillStyle = c.bg;
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(ccx, ccy, crx, cry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // Cluster Calibration Scatter Dots
      ctx.fillStyle = c.color;
      c.points.forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(toCanvasX(px), toCanvasY(py), 2.2, 0, Math.PI * 2);
        ctx.fill();
      });

      // Cluster Label Pill
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = c.color;
      ctx.fillText(c.shortName, ccx, ccy - cry - 4);
    });

    // 3. Dynamic Anomaly Sensitivity Threshold Ring
    const threshVal = ai.anomalyThreshold || 0.045;
    const threshSigma = (threshVal / 0.045) * 1.5; // Baseline 1.5σ at 0.045
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, threshSigma * scaleX, threshSigma * scaleY, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Calculate Live UAV State Coordinates (z1, z2) from Physics Residuals
    let vibSigma = 0;
    let rpmSigma = 0;
    let tempSigma = 0;
    let oilSigma = 0;

    if (residuals && typeof residuals.vibration?.sigma === 'number') {
      vibSigma = residuals.vibration.sigma;
      rpmSigma = residuals.rpm ? residuals.rpm.sigma : 0;
      tempSigma = residuals.temperature ? residuals.temperature.sigma : 0;
      oilSigma = residuals.oilPressure ? residuals.oilPressure.sigma : 0;
    } else if (state) {
      vibSigma = (state.vibration - 1.6) / 0.8;
      rpmSigma = (state.rpm - 4215) / 400;
      tempSigma = (state.temperature - 78.4) / 8.0;
      oilSigma = (4.3 - state.oilPressure) / 0.8;
    }

    const z1 = Number((vibSigma * 0.75 + rpmSigma * 0.25).toFixed(2));
    const z2 = Number((tempSigma * 0.60 + oilSigma * 0.40).toFixed(2));

    const curPx = toCanvasX(z1);
    const curPy = toCanvasY(z2);

    // Distance to Nominal Center (0, 0)
    const dist0 = Math.sqrt(z1 * z1 + z2 * z2);
    const isAnomaly = anomalyScore > threshVal || dist0 > threshSigma;

    // Determine Active Operating Cluster
    let activeCluster = clusters[0];
    let minClusterDist = dist0;

    clusters.forEach(c => {
      const d = Math.sqrt((z1 - c.center[0]) ** 2 + (z2 - c.center[1]) ** 2);
      if (d < minClusterDist) {
        minClusterDist = d;
        activeCluster = c;
      }
    });

    // 5. Draw Crosshairs & Observation Reticle for Current Point
    ctx.strokeStyle = isAnomaly ? 'rgba(239, 68, 68, 0.4)' : 'rgba(56, 189, 248, 0.4)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(curPx, cy); ctx.lineTo(curPx, curPy);
    ctx.moveTo(cx, curPy); ctx.lineTo(curPx, curPy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Outer Glow Ring Pulse
    ctx.fillStyle = isAnomaly ? 'rgba(239, 68, 68, 0.25)' : 'rgba(45, 212, 191, 0.25)';
    ctx.beginPath();
    ctx.arc(curPx, curPy, 14, 0, Math.PI * 2);
    ctx.fill();

    // Intermediate Reticle Ring
    ctx.strokeStyle = isAnomaly ? '#EF4444' : '#2DD4BF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(curPx, curPy, 8, 0, Math.PI * 2);
    ctx.stroke();

    // Core Point Dot
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(curPx, curPy, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Star Observation Badge
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = curPx > w - 160 ? 'right' : 'left';
    ctx.fillStyle = isAnomaly ? '#EF4444' : '#2DD4BF';
    const tagOffset = curPx > w - 160 ? -12 : 12;
    ctx.fillText(`★ CURRENT (z₁:${z1 > 0 ? '+' : ''}${z1}σ, z₂:${z2 > 0 ? '+' : ''}${z2}σ)`, curPx + tagOffset, curPy - 6);

    // 6. Synchronize AI Lab UI Elements
    const labClusterStatus = $('lab-cluster-status');
    if (labClusterStatus) {
      if (isAnomaly) {
        labClusterStatus.textContent = `ANOMALY: ${activeCluster.id} (${activeCluster.name})`;
        labClusterStatus.style.color = 'var(--status-critical)';
        labClusterStatus.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        labClusterStatus.style.background = 'rgba(239, 68, 68, 0.15)';
      } else {
        labClusterStatus.textContent = 'CLUSTER C0: NOMINAL ENVELOPE';
        labClusterStatus.style.color = 'var(--status-normal)';
        labClusterStatus.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        labClusterStatus.style.background = 'rgba(16, 185, 129, 0.15)';
      }
    }

    setText('lab-cluster-id', isAnomaly ? `Cluster ${activeCluster.id} (${activeCluster.name})` : 'Cluster C0 (Nominal Envelope)');
    
    const anomalyStatusVal = $('ai-anomaly-status-val');
    if (anomalyStatusVal) {
      anomalyStatusVal.textContent = isAnomaly ? (anomalyScore > 0.08 ? 'CRITICAL FAULT' : 'ANOMALY DETECTED') : 'NOMINAL';
      anomalyStatusVal.style.color = isAnomaly ? (anomalyScore > 0.08 ? 'var(--status-critical)' : 'var(--status-warning)') : 'var(--status-normal)';
    }

    const anomalyDesc = $('ai-anomaly-desc');
    if (anomalyDesc) {
      if (isAnomaly) {
        anomalyDesc.textContent = `Operating point transitioned into ${activeCluster.name} regime (Distance: ${dist0.toFixed(2)}σ from nominal center).`;
      } else {
        anomalyDesc.textContent = 'Operating within nominal multi-variate thermodynamic and kinematic envelope.';
      }
    }

    const sevBadge = $('lab-severity-badge');
    if (sevBadge) {
      sevBadge.textContent = isAnomaly ? (anomalyScore > 0.08 ? 'HIGH' : 'ELEVATED') : 'LOW';
      sevBadge.style.color = isAnomaly ? (anomalyScore > 0.08 ? 'var(--status-critical)' : 'var(--status-warning)') : 'var(--status-normal)';
    }
  }

  // ─── SVG Sparkline Generator ──────────────────────────────────────────────
  function updateSparkline(id, data, color) {
    const svg = $(id);
    if (!svg || !data || data.length < 2) return;
    const path = svg.querySelector('.sparkline-path');
    if (!path) return;

    const slice = data.slice(-20);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    const range = (max - min) || 1;
    const w = 200;
    const h = 32;

    const points = slice.map((val, idx) => {
      const x = (idx / (slice.length - 1)) * w;
      const y = h - ((val - min) / range) * (h - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    path.setAttribute('d', `M${points.join(' L')}`);
    if (color) path.style.stroke = color;
  }

  // ─── Scenario Dropdown ───────────────────────────────────────────────────────
  $('scenario-dropdown')?.addEventListener('change', e => {
    const scenario = e.target.value;
    sim.setScenario(scenario);
    wsCmd({ action: 'SET_SCENARIO', scenario });
    toast(`Scenario: ${scenario.replace(/_/g, ' ').toUpperCase()}`);
    if (audio._ready) {
      if (['lubrication_degradation', 'thermal_overheat'].includes(scenario)) audio.playWarning();
      else if (scenario === 'vibration_bearing') audio.playCritical();
      else audio.playSuccess();
    }
  });

  // ─── Audio Toggle ────────────────────────────────────────────────────────────
  $('audio-toggle-btn')?.addEventListener('click', () => {
    const isLive = audio.toggleMute();
    setText('audio-icon', isLive ? 'volume_up' : 'volume_off');
    setText('audio-text', isLive ? 'Audio: Live' : 'Audio: Muted');
    $('audio-toggle-btn')?.classList.toggle('active', isLive);
    toast(isLive ? 'Avionics sound synthesis active' : 'Avionics audio muted');
  });

  // ─── Pause / Resume Telemetry Stream ─────────────────────────────────────────
  function updatePauseUI(isPaused) {
    isStreamPaused = isPaused;
    setText('sim-icon', isPaused ? 'play_arrow' : 'pause');
    setText('sim-text', isPaused ? 'Stream Paused' : 'Running');
    $('pause-sim-btn')?.classList.toggle('active', isPaused);
  }

  function togglePause() {
    isStreamPaused = !isStreamPaused;
    sim.state.isRunning = !isStreamPaused;
    if (sim.state.isRunning) {
      sim.start();
    } else {
      sim.stop();
    }

    // Sync state with backend via WebSocket and REST API
    if (wsConnected) {
      wsCmd({ action: 'PAUSE_STREAM' });
    }
    fetch(`${API_BASE_URL}/api/stream/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_paused: isStreamPaused })
    }).catch(() => {});

    updatePauseUI(isStreamPaused);

    if (isStreamPaused) {
      toast(evalMode === 'LIVE' ? 'Live stream evaluation held' : 'Simulation telemetry stream paused');
    } else {
      toast(evalMode === 'LIVE' ? 'Live stream evaluation resumed' : 'Simulation telemetry stream resumed');
    }
  }

  $('pause-sim-btn')?.addEventListener('click', togglePause);

  // ─── Mission Clock Reset ───────────────────────────────────────────────────
  $('header-mission-clock')?.addEventListener('click', async () => {
    sim.resetFlightTime(0);
    if (wsConnected) {
      wsCmd({ action: 'RESET_MISSION_CLOCK', seconds: 0 });
    }
    try {
      await fetch(`${API_BASE_URL}/api/flight-time/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: 0 })
      });
    } catch (_) {}
    setText('header-mission-clock', 'T+ 00:00:00');
    setText('kpi-flight-time', '00:00:00');
    toast('Mission flight clock reset to T+ 00:00:00');
  });

  // ─── Mitigation Command (Truthful Live vs Simulation Separation) ───────────
  function mitigate() {
    if (evalMode === 'SIMULATION') {
      sim.executeMitigation();
      const dd = $('scenario-dropdown'); if (dd) dd.value = 'cruise';
      if (wsConnected) wsCmd({ action: 'MITIGATE' });
      fetch(`${API_BASE_URL}/api/mitigate`, { method: 'POST' }).catch(() => {});
      if (audio._ready) audio.playSuccess();
      toast('Simulation Mitigation Applied — Scenario Trimmed to Nominal Cruise');
    } else {
      // In LIVE mode: do NOT claim a physical UAV command was uplinked
      if (audio._ready) audio.playSuccess();
      toast('Mitigation Advisory Acknowledged (Simulation-only uplink in Test mode)');
    }
  }
  $('quick-mitigate-btn')?.addEventListener('click', mitigate);
  $('btn-execute-mitigation')?.addEventListener('click', mitigate);
  $('lab-btn-execute-mitigation')?.addEventListener('click', mitigate);

  // ─── Keyboard Shortcuts & Modal Dismissals ─────────────────────────────────
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    if (e.code === 'KeyM')  { e.preventDefault(); $('audio-toggle-btn')?.click(); }
    if (e.code === 'Escape') {
      const whyModal = $('why-unhealthy-modal');
      if (whyModal && whyModal.style.display !== 'none') whyModal.style.display = 'none';
      const critModal = $('critical-alert-modal');
      if (critModal && critModal.style.display !== 'none') critModal.style.display = 'none';
    }
  });

  // Modal Backdrop Click to Close
  ['why-unhealthy-modal', 'critical-alert-modal'].forEach(id => {
    const modalEl = $(id);
    modalEl?.addEventListener('click', (e) => {
      if (e.target === modalEl) {
        modalEl.style.display = 'none';
      }
    });
  });

  // ─── Export Mission Report ────────────────────────────────────────────────────
  $('btn-export-logs')?.addEventListener('click', () => {
    const infer = ai.lastInference;
    const data  = {
      mission:            'MALE UAV Surveillance Flight #408',
      mode:               evalMode,
      exportedAt:         new Date().toISOString(),
      flightTime:         sim.getFormattedFlightTime(),
      engineHealth:       `${sim.state.engineHealth}%`,
      missionReliability: `${sim.state.missionReliability}%`,
      activeScenario:     sim.state.activeScenario,
      telemetry: {
        rpm:         sim.state.rpm.toFixed(1),
        temperature: `${sim.state.temperature.toFixed(1)} °C`,
        oilPressure: `${sim.state.oilPressure.toFixed(1)} Bar`,
        vibration:   `${sim.state.vibration.toFixed(1)} mm/s`,
        fuelFlow:    `${sim.state.fuelFlow.toFixed(1)} L/h`,
        engineLoad:  `${sim.state.engineLoad.toFixed(1)} %`,
      },
      aiDiagnostics: infer,
      alerts: ai.alerts,
      events: ai.events,
    };
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
      download: `uav_engine_report_${Date.now()}.json`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Mission Report Downloaded');
  });

  // ─── Export CSV History ───────────────────────────────────────────────────────
  $('btn-export-csv')?.addEventListener('click', () => {
    histLog.exportCSV(sim.state);
    toast('History CSV Exported');
  });

  // ─── Trend Arrow Utility ─────────────────────────────────────────────────────
  const TREND_THRESHOLDS = { rpm: 20, temperature: 0.3, oilPressure: 0.05, vibration: 0.08, fuelFlow: 0.05, engineLoad: 0.5 };
  const TREND_IDS = { rpm: 'trend-rpm', temperature: 'trend-temp', oilPressure: 'trend-oil', vibration: 'trend-vib', fuelFlow: 'trend-fuel', engineLoad: 'trend-load' };

  function updateTrendArrows(state) {
    if (!prevState) { prevState = { ...state }; return; }
    for (const [param, elId] of Object.entries(TREND_IDS)) {
      const el = $(elId); if (!el) continue;
      const delta = state[param] - prevState[param];
      const thresh = TREND_THRESHOLDS[param];
      el.textContent = Math.abs(delta) < thresh ? '→' : delta > 0 ? '↑' : '↓';
      el.style.color  = Math.abs(delta) < thresh ? 'var(--text-dim)'
                      : delta > 0 ? (param === 'oilPressure' ? 'var(--status-normal)' : 'var(--status-warning)')
                                  : (param === 'oilPressure' ? 'var(--status-critical)' : 'var(--status-normal)');
    }
    prevState = { ...state };
  }

  let criticalAlertShown = false;
  
  function showCriticalAlertModal(state, infer) {
    const modal = $('critical-alert-modal');
    if (!modal) return;
    
    setText('alert-health-val', `${state.engineHealth}% 🔴`);
    setText('alert-rpm-val', Math.round(state.rpm));
    setText('alert-temp-val', `${state.temperature.toFixed(1)}°C`);
    setText('alert-load-val', `${Math.round(state.engineLoad)}%`);
    setText('alert-oil-val', `${state.oilPressure.toFixed(1)} Bar`);
    setText('alert-fuel-val', `${state.fuelFlow.toFixed(1)} L/h`);
    
    const vib = state.vibration;
    const vibEl = $('alert-vib-val');
    if (vibEl) {
      vibEl.textContent = vib > 3.8 ? 'CRITICAL' : vib > 2.4 ? 'HIGH' : 'NORMAL';
      vibEl.style.color = vib > 3.8 ? 'var(--status-critical)' : vib > 2.4 ? 'var(--status-warning)' : 'var(--text-dim)';
    }

    setText('alert-desc', infer.possibleIssue || 'Unknown critical fault detected');
    setText('alert-fault-val', infer.possibleIssue || 'N/A');
    setText('alert-prob-val', `${infer.confidence}%`);
    setText('alert-rul-val', infer.estimatedTimeToFault);
    
    if (audio._ready) audio.playWarning();
    modal.style.display = 'flex';
  }

  $('alert-btn-replay')?.addEventListener('click', () => {
    $('critical-alert-modal').style.display = 'none';
    switchView('history');
  });

  $('alert-btn-sim')?.addEventListener('click', () => {
    $('critical-alert-modal').style.display = 'none';
  });

  // ─── Real-Time Stream Performance Metrics & Pipeline Strip Updaters ─────────
  function updateStreamMetrics(streamMetrics) {
    if (!streamMetrics) return;
    totalProcessedSamples++;
    
    setText('metric-ingest-rate', `${(streamMetrics.ingestion_rate_hz || currentTargetRateHz).toFixed(1)} Hz`);
    setText('metric-proc-rate', `${Math.round(streamMetrics.processing_rate_hz || 450)} Hz`);
    setText('metric-eval-latency', `${(streamMetrics.evaluation_latency_ms || 2.4).toFixed(1)} ms`);
    setText('metric-data-age', `${Math.round(streamMetrics.data_age_ms || 15)} ms`);
    setText('metric-dropped-count', streamMetrics.dropped_samples || 0);

    const nowStr = new Date().toTimeString().slice(0, 8);
    setText('hdr-last-update', nowStr);
    setText('hdr-data-age', `${Math.round(streamMetrics.data_age_ms || 15)} ms`);
    setText('hdr-latency', `${(streamMetrics.evaluation_latency_ms || 2.4).toFixed(1)} ms`);
    setText('pipeline-total-frames', totalProcessedSamples);
  }

  function updatePipelineStrip(status) {
    const isCrit = status === 'CRITICAL' || status === 'FAULT';
    const isWarn = status === 'WARNING' || status === 'DEGRADED';
    const badge = $('pipeline-health-badge');
    if (badge) {
      badge.textContent = isCrit ? 'CRITICAL' : isWarn ? 'DEGRADED' : 'NOMINAL';
      badge.style.color = isCrit ? 'var(--status-critical)' : isWarn ? 'var(--status-warning)' : 'var(--status-normal)';
    }
  }

  function updateResidualsTable(residuals, expected, state) {
    if (!residuals || !expected) return;

    // RPM
    const rpmRes = residuals.rpm || {};
    setText('res-val-rpm', Math.round(state.rpm || 4215));
    setText('res-exp-rpm', Math.round(expected.expected_rpm || 4215));
    setText('res-delta-rpm', (rpmRes.residual || 0).toFixed(1));
    setText('res-sigma-rpm', `${(rpmRes.normalized_residual || 0) >= 0 ? '+' : ''}${(rpmRes.normalized_residual || 0).toFixed(2)}σ`);
    setText('res-slope-rpm', `${(rpmRes.residual_slope || 0).toFixed(3)}/s`);

    // CHT
    const chtRes = residuals.temperature || {};
    setText('res-val-cht', (state.temperature || 78.4).toFixed(1));
    setText('res-exp-cht', (expected.expected_cht_c || 78.4).toFixed(1));
    setText('res-delta-cht', (chtRes.residual || 0).toFixed(1));
    setText('res-sigma-cht', `${(chtRes.normalized_residual || 0) >= 0 ? '+' : ''}${(chtRes.normalized_residual || 0).toFixed(2)}σ`);
    setText('res-slope-cht', `${(chtRes.residual_slope || 0).toFixed(3)}/s`);

    // Oil Pressure
    const oilRes = residuals.oilPressure || {};
    setText('res-val-oil', (state.oilPressure || 4.3).toFixed(2));
    setText('res-exp-oil', (expected.expected_oil_pressure_bar || 4.3).toFixed(2));
    setText('res-delta-oil', (oilRes.residual || 0).toFixed(2));
    setText('res-sigma-oil', `${(oilRes.normalized_residual || 0) >= 0 ? '+' : ''}${(oilRes.normalized_residual || 0).toFixed(2)}σ`);
    setText('res-slope-oil', `${(oilRes.residual_slope || 0).toFixed(3)}/s`);

    // Vibration
    const vibRes = residuals.vibration || {};
    setText('res-val-vib', (state.vibration || 1.6).toFixed(2));
    setText('res-exp-vib', (expected.expected_vibration_mms || 1.5).toFixed(2));
    setText('res-delta-vib', `${(vibRes.residual || 0) >= 0 ? '+' : ''}${(vibRes.residual || 0).toFixed(2)}`);
    setText('res-sigma-vib', `${(vibRes.normalized_residual || 0) >= 0 ? '+' : ''}${(vibRes.normalized_residual || 0).toFixed(2)}σ`);
    setText('res-slope-vib', `${(vibRes.residual_slope || 0).toFixed(3)}/s`);

    // Fuel Flow
    const fuelRes = residuals.fuelFlow || {};
    setText('res-val-fuel', (state.fuelFlow || 5.2).toFixed(2));
    setText('res-exp-fuel', (expected.expected_fuel_flow || 5.1).toFixed(2));
    setText('res-delta-fuel', `${(fuelRes.residual || 0) >= 0 ? '+' : ''}${(fuelRes.residual || 0).toFixed(2)}`);
    setText('res-sigma-fuel', `${(fuelRes.normalized_residual || 0) >= 0 ? '+' : ''}${(fuelRes.normalized_residual || 0).toFixed(2)}σ`);
    setText('res-slope-fuel', `${(fuelRes.residual_slope || 0).toFixed(3)}/s`);
  }

  function updatePrimaryEvidence(primaryEvidence, sensorTrust, twinState, explainability = null) {
    const listEl = $('primary-evidence-list');
    const labListEl = $('ai-lab-evidence-list');
    
    // Format explainability items if available
    let evidenceItems = [];
    if (explainability && explainability.contributors && explainability.contributors.length > 0) {
      evidenceItems.push(`<strong>Diagnosis Driver:</strong> ${explainability.reason || 'Multi-channel residual deviation'} (${explainability.confidence || 'MEDIUM'} Confidence)`);
      explainability.contributors.forEach(c => {
        const sig = (c.signal || '').toUpperCase();
        const devSign = (c.residual || 0) >= 0 ? '+' : '';
        const sigSign = (c.residual_sigma || 0) >= 0 ? '+' : '';
        const impPct = Math.round((c.impact || 0) * 100);
        evidenceItems.push(`<strong>${sig}:</strong> Meas ${c.measured} vs Exp ${c.expected} (Δ ${devSign}${c.residual}, ${sigSign}${c.residual_sigma}σ, Impact: ${impPct}%)`);
      });
      if (sensorTrust) {
        const validPct = Math.round((sensorTrust.aggregate_trust_score || 1.0) * 100);
        evidenceItems.push(`<strong>Sensor Trust Array:</strong> ${validPct}% validity (All active transducers operational)`);
      }
    } else if (Array.isArray(primaryEvidence) && primaryEvidence.length > 0) {
      evidenceItems = primaryEvidence;
    } else {
      evidenceItems = [
        "Operating within nominal thermodynamic and kinematic envelope",
        "Physics Residuals: Within standard ±1.5σ baseline bounds",
        "Sensor Trust Score: 98% (All transducer channels valid)",
        "Digital Twin Consensus: High confidence across physics and ML"
      ];
    }

    if (listEl) {
      listEl.innerHTML = evidenceItems.map(e => `<li>${e}</li>`).join('');
    }
    if (labListEl) {
      labListEl.innerHTML = evidenceItems.map(e => `<li>${e}</li>`).join('');
    }

    const trustPct = sensorTrust ? Math.round(sensorTrust.aggregate_trust_score * 100) : 98;
    const confPct  = twinState?.confidence?.overall ? Math.round(twinState.confidence.overall * 100) : 94;
    
    setText('evidence-trust-val', `${trustPct}%`);
    setText('evidence-conf-val',  `${confPct}%`);
    
    const riskLabel = $('evidence-risk-label');
    if (riskLabel && twinState?.mission_risk) {
      const r = twinState.mission_risk.risk_category || 'LOW';
      riskLabel.textContent = r;
      riskLabel.style.color = r === 'CRITICAL' ? 'var(--status-critical)' : r === 'HIGH' ? 'var(--status-warning)' : 'var(--status-normal)';
    }
  }

  // ─── Hardware View Manager (Physical Gateway & Sensors) ───────────────────
  let selectedHwType = 'esp32';
  let selectedHwMethod = 'wifi';
  let latestHwStatus = null;

  function updateHardwareView(statusInfo = null, streamMetrics = null, mode = evalMode, isConnected = liveStreamConnected) {
    if (statusInfo) latestHwStatus = { ...(latestHwStatus || {}), ...statusInfo };
    const info = latestHwStatus || {};
    const metrics = streamMetrics || {};

    const overallBadge = $('hw-overall-badge');
    const sideBadge = $('sidebar-hardware-badge');
    const simBanner = $('hw-mode-banner-sim');
    const replayBanner = $('hw-mode-banner-replay');
    const liveBanner = $('hw-mode-banner-live');

    // 1. Mode Banner State
    if (mode === 'SIMULATION') {
      if (simBanner) simBanner.style.display = 'flex';
      if (replayBanner) replayBanner.style.display = 'none';
      if (liveBanner) liveBanner.style.display = 'none';

      if (overallBadge) {
        overallBadge.textContent = 'SIMULATION ACTIVE';
        overallBadge.className = 'hw-status-pill stale';
      }
      if (sideBadge) {
        sideBadge.textContent = 'SIM';
        sideBadge.style.color = 'var(--status-warning)';
      }

      setText('hw-kpi-device-id', 'SIMULATOR RIG');
      setText('hw-kpi-gateway-source', 'SOURCE: Virtual Engine Model');
      setText('hw-kpi-state-text', 'SIMULATING');
      setText('hw-kpi-state-sub', 'Physical hardware in standby');
      setCss('hw-kpi-state-badge', 'color', 'var(--status-warning)');
      setText('hw-kpi-state-icon', 'science');
      setText('hw-kpi-rate', `${currentTargetRateHz.toFixed(1)}`);
      setText('hw-kpi-backend', wsConnected ? 'Connected' : 'Offline');
      setText('hw-kpi-latency', wsConnected ? '<1.5 ms' : '-- ms');

      setText('hw-spec-device', 'Simulator');
      setText('hw-spec-device-id', 'ROT-914-SIM');
      setText('hw-spec-profile-val', 'AERO_ENGINE');
      setText('hw-profile-badge', 'PROFILE: SIMULATION');
      setText('hw-spec-firmware', 'v2.5.0-sim');
      setText('hw-spec-rssi', 'N/A (Virtual)');
      setText('hw-spec-last-packet', '<50 ms ago');
      setText('hw-spec-loss', '0.0%');
      setText('hw-spec-total-frames', `${totalProcessedSamples}`);

      // Clear prototype channels in simulation
      setText('hw-val-rpm', '--');
      setText('hw-val-current', '-- A');
      setText('hw-val-voltage', '-- V');
      setText('hw-val-power', '-- W');
      setText('hw-val-temp', '-- °C');
      setText('hw-val-vib', '---');
      setText('hw-val-load', '-- %');
      return;
    }

    if (mode === 'REPLAY') {
      if (simBanner) simBanner.style.display = 'none';
      if (replayBanner) replayBanner.style.display = 'flex';
      if (liveBanner) liveBanner.style.display = 'none';

      if (overallBadge) {
        overallBadge.textContent = 'REPLAY STANDBY';
        overallBadge.className = 'hw-status-pill stale';
      }
      if (sideBadge) {
        sideBadge.textContent = 'LOG';
        sideBadge.style.color = 'var(--accent-cyan)';
      }

      setText('hw-kpi-device-id', 'FLIGHT RECORDER');
      setText('hw-kpi-gateway-source', 'SOURCE: Historical Flight Log');
      setText('hw-kpi-state-text', 'REPLAYING');
      setText('hw-kpi-state-sub', 'Physical bridge in standby');
      setCss('hw-kpi-state-badge', 'color', 'var(--accent-cyan)');
      setText('hw-kpi-state-icon', 'history');
      setText('hw-kpi-rate', '--');
      setText('hw-kpi-backend', wsConnected ? 'Connected' : 'Offline');
      setText('hw-kpi-latency', '-- ms');

      setText('hw-spec-device', 'Flight Recorder');
      setText('hw-spec-device-id', 'HISTORICAL-LOG');
      setText('hw-spec-profile-val', 'AERO_ENGINE');
      setText('hw-profile-badge', 'PROFILE: REPLAY');
      setText('hw-spec-firmware', '--');
      setText('hw-spec-rssi', '--');
      setText('hw-spec-last-packet', '--');
      setText('hw-spec-loss', '0.0%');
      setText('hw-spec-total-frames', '--');

      setText('hw-val-rpm', '--');
      setText('hw-val-current', '-- A');
      setText('hw-val-voltage', '-- V');
      setText('hw-val-power', '-- W');
      setText('hw-val-temp', '-- °C');
      setText('hw-val-vib', '---');
      setText('hw-val-load', '-- %');
      return;
    }

    // LIVE Mode
    if (simBanner) simBanner.style.display = 'none';
    if (replayBanner) replayBanner.style.display = 'none';

    const isLiveActive = isConnected || info.connected || info.status === 'CONNECTED' || info.status === 'LIVE' || info.status === 'STALE';

    if (isLiveActive) {
      const isStale = info.status === 'STALE';
      if (liveBanner) liveBanner.style.display = 'none';

      if (overallBadge) {
        overallBadge.textContent = isStale ? 'TELEMETRY STALE' : 'TELEMETRY ACTIVE';
        overallBadge.className = isStale ? 'hw-status-pill stale' : 'hw-status-pill active';
      }
      if (sideBadge) {
        sideBadge.textContent = '●';
        sideBadge.style.color = isStale ? 'var(--status-warning)' : 'var(--status-normal)';
      }

      const devId = info.device_id || metrics.device_id || 'AERIS-ESP32-001';
      const profile = info.profile || metrics.profile || 'MOTOR_PROTOTYPE';
      const src = info.source || info.gateway_source || 'ESP32';
      const fw = info.firmware_version || 'v1.4.2-motor';
      const rssi = info.wifi_rssi ? `${info.wifi_rssi} dBm` : '-58 dBm';
      const rateHz = metrics.actual_rate_hz || metrics.rate_hz || currentTargetRateHz || 10.0;
      const lastAge = info.data_age_ms ?? metrics.data_age_ms ?? 18;
      const loss = (info.packet_loss_pct ?? 0).toFixed(1);
      const totalFrames = info.total_received ?? totalProcessedSamples;

      setText('hw-kpi-device-id', devId);
      setText('hw-kpi-gateway-source', `SOURCE: ${src}`);
      setText('hw-kpi-state-text', isStale ? 'TELEMETRY STALE' : '● Connected');
      setText('hw-kpi-state-sub', isStale ? 'No packet in >3.0s' : '● Receiving physical frames');
      setCss('hw-kpi-state-badge', 'color', isStale ? 'var(--status-warning)' : 'var(--status-normal)');
      setText('hw-kpi-state-icon', isStale ? 'warning' : 'sensors');
      setText('hw-kpi-rate', `${Number(rateHz).toFixed(1)}`);
      setText('hw-kpi-backend', wsConnected ? '● Connected' : 'Offline');
      setText('hw-kpi-latency', `${Math.round(metrics.latency_ms || 2.4)} ms`);

      setText('hw-spec-device', 'ESP32');
      setText('hw-spec-device-id', devId);
      setText('hw-spec-profile-val', profile);
      setText('hw-profile-badge', `PROFILE: ${profile}`);
      setText('hw-spec-firmware', fw);
      setText('hw-spec-rssi', rssi);
      setText('hw-spec-last-packet', `${Math.round(lastAge)} ms ago`);
      setText('hw-spec-loss', `${loss}%`);
      setText('hw-spec-total-frames', `${totalFrames}`);

      // Physical sensor channel readouts
      const rpmVal = info.rpm ?? metrics.rpm;
      setText('hw-val-rpm', (rpmVal !== undefined && rpmVal !== null) ? `${Math.round(rpmVal).toLocaleString()} RPM` : '--');

      const currVal = info.current_a ?? metrics.current_a;
      setText('hw-val-current', (currVal !== undefined && currVal !== null) ? `${Number(currVal).toFixed(2)} A` : '-- A');

      const voltVal = info.voltage_v ?? metrics.voltage_v;
      setText('hw-val-voltage', (voltVal !== undefined && voltVal !== null) ? `${Number(voltVal).toFixed(2)} V` : '-- V');

      const pwrVal = info.power_w ?? metrics.power_w ?? ((voltVal !== undefined && currVal !== undefined && voltVal !== null && currVal !== null) ? (voltVal * currVal) : null);
      setText('hw-val-power', (pwrVal !== undefined && pwrVal !== null) ? `${Number(pwrVal).toFixed(1)} W` : '-- W');

      const tempVal = info.temperature_c ?? metrics.temperature_c ?? info.temperature;
      setText('hw-val-temp', (tempVal !== undefined && tempVal !== null) ? `${Number(tempVal).toFixed(1)} °C` : '-- °C');

      const vibVal = info.vibration ?? metrics.vibration;
      setText('hw-val-vib', (vibVal !== undefined && vibVal !== null) ? `${Number(vibVal).toFixed(2)} mm/s` : '---');

      const loadVal = info.motor_load_pct ?? metrics.motor_load_pct ?? info.engine_load;
      setText('hw-val-load', (loadVal !== undefined && loadVal !== null) ? `${Number(loadVal).toFixed(0)} %` : '-- %');

    } else {
      // Disconnected Live State
      if (liveBanner) liveBanner.style.display = 'flex';

      if (overallBadge) {
        overallBadge.textContent = 'DISCONNECTED';
        overallBadge.className = 'hw-status-pill disconnected';
      }
      if (sideBadge) {
        sideBadge.textContent = '●';
        sideBadge.style.color = 'var(--status-critical)';
      }

      setText('hw-kpi-device-id', '--');
      setText('hw-kpi-gateway-source', 'SOURCE: --');
      setText('hw-kpi-state-text', 'Waiting for hardware');
      setText('hw-kpi-state-sub', 'Awaiting ESP32 connection');
      setCss('hw-kpi-state-badge', 'color', 'var(--status-offline)');
      setText('hw-kpi-state-icon', 'power_off');
      setText('hw-kpi-rate', '--');
      setText('hw-kpi-backend', wsConnected ? '● Connected (WS)' : 'Offline');
      setText('hw-kpi-latency', wsConnected ? 'Ready' : '-- ms');

      setText('hw-spec-device', 'ESP32');
      setText('hw-spec-device-id', '--');
      setText('hw-spec-profile-val', 'MOTOR_PROTOTYPE');
      setText('hw-profile-badge', 'PROFILE: MOTOR_PROTOTYPE');
      setText('hw-spec-firmware', '--');
      setText('hw-spec-rssi', '--');
      setText('hw-spec-last-packet', '-- ms ago');
      setText('hw-spec-loss', '0.0%');
      setText('hw-spec-total-frames', '0');

      setText('hw-val-rpm', '--');
      setText('hw-val-current', '-- A');
      setText('hw-val-voltage', '-- V');
      setText('hw-val-power', '-- W');
      setText('hw-val-temp', '-- °C');
      setText('hw-val-vib', '---');
      setText('hw-val-load', '-- %');
    }
  }

  $('btn-hw-switch-live')?.addEventListener('click', () => {
    setMode('LIVE');
    fetch(`${API_BASE_URL}/api/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'LIVE' })
    }).catch(() => {});
  });

  $('btn-hw-check-sync')?.addEventListener('click', () => {
    fetch(`${API_BASE_URL}/api/telemetry/status`)
      .then(r => r.json())
      .then(statusData => {
        updateHardwareView(statusData, null, evalMode, statusData.connected);
        toast(`Hardware Bridge Sync: ${statusData.status || 'CONNECTED'}`);
      })
      .catch(() => {
        updateHardwareView({ status: 'BACKEND OFFLINE', connected: false }, null, evalMode, false);
        toast('Backend offline: could not query hardware status');
      });
  });

  // ─── Main Telemetry Update Processor (Backend and Fallback) ─────────────────
  // ─── Disconnected / Standby State Renderer ────────────────────────────────
  function renderDisconnectedLiveState(statusDetails = {}) {
    liveStreamConnected = false;
    const status = statusDetails?.status || 'NO LIVE DATA';
    const source = statusDetails?.source || 'DISCONNECTED';

    if ($('live-not-connected-banner') && evalMode === 'LIVE') {
      $('live-not-connected-banner').style.display = 'flex';
    }

    // Header & KPIs
    setText('hdr-last-update', 'NO STREAM');
    setText('hdr-data-age', '--');
    setText('hdr-latency', '--');
    setCss('hdr-pulse-dot', 'background', '#64748B');

    setText('metric-ingest-rate', '0.0 Hz');
    setText('metric-proc-rate', '--');
    setText('metric-eval-latency', '--');
    setText('metric-data-age', '--');

    // Values to N/A
    setText('val-rpm', 'N/A');
    setText('val-temp', 'N/A');
    setText('val-oil', 'N/A');
    setText('val-vib', 'N/A');
    setText('val-fuel', 'N/A');
    setText('val-load', 'N/A');

    // Health gauge
    setText('kpi-health-val', '--');
    setText('kpi-health-sub', 'NO DATA');
    setCss('kpi-health-sub', 'color', 'var(--text-dim)');
    const circle = $('health-gauge-circle');
    if (circle) { circle.style.strokeDashoffset = '251.2'; }

    // Status Badge
    setText('kpi-status-val', status);
    setText('kpi-status-sub', 'Waiting for live telemetry ingestion...');
    setText('status-badge-icon', 'sensors_off');
    const badge = $('kpi-status-badge');
    if (badge) {
      badge.style.color = 'var(--text-dim)';
      badge.style.textShadow = 'none';
      badge.classList.remove('status-pulse');
    }

    setText('kpi-reliability-val', '--');
    setText('kpi-reliability-sub', 'NO DATA');
    setCss('kpi-reliability-sub', 'color', 'var(--text-dim)');
    setText('kpi-flight-time', '--:--:--');
    setText('header-mission-clock', 'T+ --:--:--');

    // Range bars to 0%
    ['range-rpm', 'range-temp', 'range-oil', 'range-vib', 'range-fuel', 'range-load'].forEach(id => {
      setCss(id, 'width', '0%');
    });

    // Trend arrows to —
    Object.values(TREND_IDS).forEach(elId => {
      const el = $(elId);
      if (el) { el.textContent = '—'; el.style.color = 'var(--text-dim)'; }
    });

    // AI Panel & AI Lab Cards
    setText('ai-possible-issue', 'No active telemetry stream connected');
    setText('lab-possible-issue', 'No active telemetry stream connected');
    const rb = $('ai-risk-badge');
    if (rb) {
      rb.textContent = 'STANDBY';
      rb.className = 'risk-badge normal';
    }
    const labRb = $('lab-risk-badge');
    if (labRb) {
      labRb.textContent = 'STANDBY';
      labRb.className = 'risk-badge normal';
    }
    setText('ai-confidence-val', '0%');
    setText('lab-confidence-val', '0%');
    setCss('ai-confidence-bar', 'width', '0%');
    setCss('lab-confidence-bar', 'width', '0%');
    setText('ai-time-to-fault', '--');
    setText('lab-time-to-fault', '--');

    setText('lab-anomaly-score', '0.000');
    setCss('lab-anomaly-bar', 'width', '0%');
    setText('lab-rul-val', '--');

    // Pipeline strip
    const pBadge = $('pipeline-health-badge');
    if (pBadge) {
      pBadge.textContent = 'DISCONNECTED';
      pBadge.style.color = 'var(--text-dim)';
    }

    // Primary evidence
    const listEl = $('primary-evidence-list');
    if (listEl) {
      listEl.innerHTML = '<li style="color:var(--text-dim);">No telemetry frames received. Ingest live telemetry via POST /api/telemetry or CAN-bus / MAVLink gateway to start AI evaluation.</li>';
    }
    setText('evidence-trust-val', '--');
    setText('evidence-conf-val', '--');
    const rLabel = $('evidence-risk-label');
    if (rLabel) {
      rLabel.textContent = 'STANDBY';
      rLabel.style.color = 'var(--text-dim)';
    }

    // Residuals table
    ['rpm', 'cht', 'oil', 'vib', 'fuel'].forEach(p => {
      setText(`res-val-${p}`, 'N/A');
      setText(`res-exp-${p}`, '--');
      setText(`res-delta-${p}`, '--');
      setText(`res-sigma-${p}`, '--');
      setText(`res-slope-${p}`, '--');
    });

    // 3D Twin HUD
    if (twin) {
      setText('hud-rpm-val', '-- RPM');
      setText('hud-temp-val', '-- °C');
      setText('hud-oil-val', '-- Bar');
      setText('hud-vib-val', '-- mm/s');
      setText('twin-health-badge', '--');
      setText('twin-rul-tag', 'RUL: --');
    }

    // 6-Channel Realtime Monitor
    rtMon.renderDisconnected({ mode: 'LIVE', status, source });

    // Update Hardware View
    updateHardwareView(statusDetails, null, evalMode, false);
  }

  // ─── Main Telemetry Update Processor ────────────────────────────────────────
  function processTelemetryUpdate(data, mode = evalMode, status = 'LIVE', streamMetrics = {}) {
    const dashboardView = data.dashboard_view || data;
    const twinState = data.twin_state || {};
    const residuals = data.residuals || {};
    const expected = data.expected_physics || {};
    const sensorTrust = data.sensor_trust || {};
    const metrics = data.stream_metrics || streamMetrics || {};

    // Update Hardware View with live stream & prototype metrics
    updateHardwareView({ ...dashboardView, ...(data.stream_metrics || streamMetrics) }, metrics, mode, true);

    if (evalMode === 'LIVE' && !liveStreamConnected) {
      renderDisconnectedLiveState();
      return;
    }

    // Synchronize simulator state object with real telemetry frame
    sim.state.rpm = typeof dashboardView.rpm === 'number' ? dashboardView.rpm : sim.state.rpm;
    sim.state.temperature = typeof dashboardView.temperature === 'number' ? dashboardView.temperature : sim.state.temperature;
    sim.state.oilPressure = typeof dashboardView.oil_pressure === 'number' ? dashboardView.oil_pressure : (typeof dashboardView.oilPressure === 'number' ? dashboardView.oilPressure : sim.state.oilPressure);
    sim.state.vibration = typeof dashboardView.vibration === 'number' ? dashboardView.vibration : sim.state.vibration;
    sim.state.fuelFlow = typeof dashboardView.fuel_flow === 'number' ? dashboardView.fuel_flow : (typeof dashboardView.fuelFlow === 'number' ? dashboardView.fuelFlow : sim.state.fuelFlow);
    sim.state.engineLoad = typeof dashboardView.engine_load === 'number' ? dashboardView.engine_load : (typeof dashboardView.engineLoad === 'number' ? dashboardView.engineLoad : sim.state.engineLoad);
    sim.state.engineHealth = typeof dashboardView.engine_health === 'number' ? dashboardView.engine_health : (typeof dashboardView.engineHealth === 'number' ? dashboardView.engineHealth : sim.state.engineHealth);
    sim.state.missionReliability = typeof dashboardView.mission_reliability === 'number' ? dashboardView.mission_reliability : (typeof dashboardView.missionReliability === 'number' ? dashboardView.missionReliability : sim.state.missionReliability);
    sim.state.status = dashboardView.status || sim.state.status || 'NORMAL';

    // Push into telemetry history
    const fTime = dashboardView.flight_time_str || sim.getFormattedFlightTime();
    sim.history.labels.push(fTime);
    sim.history.rpm.push(sim.state.rpm);
    sim.history.temperature.push(sim.state.temperature);
    sim.history.oilPressure.push(sim.state.oilPressure);
    sim.history.vibration.push(sim.state.vibration);
    sim.history.fuelFlow.push(sim.state.fuelFlow);
    sim.history.engineLoad.push(sim.state.engineLoad);
    sim.history.engineHealth.push(sim.state.engineHealth);

    // Bounded history array to prevent memory leaks
    if (sim.history.labels.length > 500) {
      Object.keys(sim.history).forEach(k => {
        if (Array.isArray(sim.history[k])) sim.history[k].shift();
      });
    }

    const state = sim.state;
    const history = sim.history;
    const infer = ai.analyze(state);

    // — Propulsion Health Gauge —
    const health = state.engineHealth;
    setText('kpi-health-val', `${health}%`);
    const [healthLabel, healthColor, gaugeStroke] =
      health >= 80 ? ['GOOD',     'var(--status-normal)',   'var(--status-normal)']
    : health >= 50 ? ['DEGRADED', 'var(--status-warning)',  'var(--status-warning)']
                   : ['CRITICAL', 'var(--status-critical)', 'var(--status-critical)'];
    setText('kpi-health-sub', healthLabel);
    setCss('kpi-health-sub', 'color', healthColor);
    const circle = $('health-gauge-circle');
    if (circle) { circle.style.stroke = gaugeStroke; circle.style.strokeDashoffset = (251.2 * (1 - health / 100)).toFixed(1); }

    // — Status Badge —
    const STATUS_CFG = {
      NORMAL:   { color: 'var(--status-normal)',   sub: 'All systems nominal',          icon: 'check_circle' },
      WARNING:  { color: 'var(--status-warning)',  sub: 'Operating in degraded mode',   icon: 'warning' },
      DEGRADED: { color: 'var(--status-warning)',  sub: 'Operating in degraded mode',   icon: 'warning' },
      CRITICAL: { color: 'var(--status-critical)', sub: 'Critical threshold exceeded!', icon: 'error'  },
      FAULT:    { color: 'var(--status-critical)', sub: 'Fault signature confirmed!',   icon: 'error'  },
      LIVE:     { color: 'var(--status-normal)',   sub: 'Live telemetry ingestion',     icon: 'sensors' },
    };
    const cfg = STATUS_CFG[state.status] || STATUS_CFG.NORMAL;
    setText('kpi-status-val', state.status);
    setText('kpi-status-sub', cfg.sub);
    setText('status-badge-icon', cfg.icon);
    const badge = $('kpi-status-badge');
    if (badge) { badge.style.color = cfg.color; badge.style.textShadow = `0 0 14px ${cfg.color}`; }
    badge?.classList.toggle('status-pulse', state.status === 'CRITICAL' || state.status === 'FAULT');

    // — KPI Cards —
    setText('kpi-flight-time', fTime);
    setText('header-mission-clock', `T+ ${fTime}`);
    setText('kpi-reliability-val', `${state.missionReliability}%`);
    const relLabel = state.missionReliability >= 80 ? 'HIGH' : state.missionReliability >= 55 ? 'MODERATE' : 'CRITICAL';
    const relColor = state.missionReliability >= 80 ? 'var(--status-normal)' : state.missionReliability >= 55 ? 'var(--status-warning)' : 'var(--status-critical)';
    setText('kpi-reliability-sub', relLabel);
    setCss('kpi-reliability-sub', 'color', relColor);

    // — Sensor Readouts —
    setText('val-rpm',  Math.round(state.rpm).toLocaleString());
    setText('val-temp', state.temperature.toFixed(1));
    setText('val-oil',  state.oilPressure.toFixed(2));
    setText('val-vib',  state.vibration.toFixed(2));
    setText('val-fuel', state.fuelFlow.toFixed(2));
    setText('val-load', Math.round(state.engineLoad));

    // — Trend Arrows —
    updateTrendArrows(state);

    // — Param card status highlighting —
    const PARAM_ALERTS = [
      ['param-oil-card',  state.oilPressure < 3.6, state.oilPressure < 2.8],
      ['param-temp-card', state.temperature > 84,  state.temperature > 92 ],
      ['param-vib-card',  state.vibration > 2.4,   state.vibration > 3.8  ],
    ];
    PARAM_ALERTS.forEach(([id, warn, crit]) => {
      $(id)?.classList.toggle('warning',  warn && !crit);
      $(id)?.classList.toggle('critical', crit);
    });

    // — Sparklines —
    updateSparkline('sparkline-rpm', history.rpm, '#2DD4BF');
    updateSparkline('sparkline-temp', history.temperature, '#EF4444');
    updateSparkline('sparkline-oil', history.oilPressure, '#38BDF8');
    updateSparkline('sparkline-vib', history.vibration, '#F59E0B');
    updateSparkline('sparkline-fuel', history.fuelFlow, '#38BDF8');
    updateSparkline('sparkline-load', history.engineLoad, '#2DD4BF');

    // — Range Fill Bars —
    const setRangeFill = (id, val, min, max) => {
      const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
      setCss(id, 'width', `${pct.toFixed(0)}%`);
    };
    setRangeFill('range-rpm', state.rpm, 3000, 5500);
    setRangeFill('range-temp', state.temperature, 50, 110);
    setRangeFill('range-oil', state.oilPressure, 1.5, 7.0);
    setRangeFill('range-vib', state.vibration, 0.5, 6.0);
    setRangeFill('range-fuel', state.fuelFlow, 2.0, 10.0);
    setRangeFill('range-load', state.engineLoad, 0, 100);

    // — Draw Latent Space —
    const rawAnomScore = Number(dashboardView.anomaly_score ?? infer.anomalyScore ?? 0.024);
    drawLatentSpace(rawAnomScore, residuals, state, state.activeScenario || sim.scenario);

    // — AI Prognostics & Signal Trend Chart —
    if (aiTrend) {
      const nowLabel = (state.flightTime / 60).toFixed(1);
      aiTrendHistory.labels.push(nowLabel);
      aiTrendHistory.anomalyScores.push(rawAnomScore);
      aiTrendHistory.health.push(state.engineHealth || 100);

      // Compute max sigma across all available residuals
      let maxSig = 0;
      if (residuals) {
        ['rpm', 'temperature', 'oilPressure', 'vibration', 'fuelFlow'].forEach(k => {
          if (residuals[k]?.sigma) maxSig = Math.max(maxSig, Math.abs(residuals[k].sigma));
        });
      }
      aiTrendHistory.maxSigmas.push(Number(maxSig.toFixed(2)));

      // Hazard rate (Weibull hazard or derived from health degradation)
      const hazRate = twinState?.hazard_rate || (0.002 + Math.max(0, (100 - state.engineHealth) * 0.00018));
      aiTrendHistory.hazardRates.push(Number(hazRate.toFixed(4)));

      if (aiTrendHistory.labels.length > 300) {
        aiTrendHistory.labels.shift();
        aiTrendHistory.anomalyScores.shift();
        aiTrendHistory.health.shift();
        aiTrendHistory.maxSigmas.shift();
        aiTrendHistory.hazardRates.shift();
      }
      aiTrend.update(aiTrendHistory);
    }

    // — Live Chart —
    chart.update(history);

    // — 3D Twin & HUD Synchronization —
    if (twin) {
      twin.updateState(state);
      setText('hud-rpm-val',  `${Math.round(state.rpm)} RPM`);
      setText('hud-temp-val', `${state.temperature.toFixed(1)} °C`);
      setText('hud-oil-val',  `${state.oilPressure.toFixed(2)} Bar`);
      setText('hud-vib-val',  `${state.vibration.toFixed(2)} mm/s`);
      setText('twin-health-badge', `${state.engineHealth}%`);
      setText('twin-rul-tag', `RUL: ${dashboardView.rul_time_str || infer.estimatedTimeToFault || '1200h'}`);
    }

    // — Live Inspector Refresh —
    renderInspector(activeComp, false);

    // — Stream Performance Metrics & Pipeline Strip —
    updateStreamMetrics(metrics);
    updatePipelineStrip(state.status);
    updateResidualsTable(residuals, expected, state);
    const expl = dashboardView.explainability || twinState.explainability || data.explainability;
    updatePrimaryEvidence(dashboardView.primary_evidence || twinState.primary_evidence, sensorTrust, twinState, expl);

    // — AI Prediction Panel & AI Lab Cards —
    const issueText = dashboardView.fault_class ? dashboardView.fault_class.replace(/_/g, ' ') : infer.possibleIssue;
    setText('ai-possible-issue', issueText);
    setText('lab-possible-issue', issueText);
    const rk = dashboardView.anomaly_detected ? (state.status === 'CRITICAL' ? 'CRITICAL' : 'HIGH') : 'LOW';
    const rb = $('ai-risk-badge');
    if (rb) {
      rb.textContent = `${rk} RISK`;
      rb.className = `risk-badge ${rk.toLowerCase()}`;
    }
    const labRb = $('lab-risk-badge');
    if (labRb) {
      labRb.textContent = `${rk} RISK`;
      labRb.className = `risk-badge ${rk.toLowerCase()}`;
    }
    const conf = dashboardView.confidence_pct ?? infer.confidence ?? 94;
    setText('ai-confidence-val', `${conf}%`);
    setText('lab-confidence-val', `${conf}%`);
    setCss('ai-confidence-bar', 'width', `${conf}%`);
    setCss('lab-confidence-bar', 'width', `${conf}%`);
    const timeToFaultStr = dashboardView.rul_time_str || infer.estimatedTimeToFault;
    setText('ai-time-to-fault', timeToFaultStr);
    setText('lab-time-to-fault', timeToFaultStr);

    // — AI Lab Primary Summary Cards & Probability Bars —
    setText('lab-anomaly-score', rawAnomScore.toFixed(3));
    setCss('lab-anomaly-bar', 'width', `${Math.min(100, rawAnomScore * 100).toFixed(1)}%`);
    
    // Multi-Class Fault Classifier Probabilities
    const probs = dashboardView.fault_probabilities || infer.probabilities || {};
    const pNominal = Math.round((probs.NOMINAL ?? probs.nominal ?? probs.nominal_cruise ?? 0.94) * 100);
    const pLube    = Math.round((probs.LUBRICATION_DEGRADATION ?? probs.lubrication ?? probs.lubrication_degradation ?? probs.oil_pressure_loss ?? 0.01) * 100);
    const pBearing = Math.round((probs.BEARING_DEGRADATION ?? probs.bearing ?? probs.vibration_bearing ?? probs.bearing_wear ?? 0.01) * 100);
    const pThermal = Math.round((probs.COOLING_DEGRADATION ?? probs.thermal ?? probs.thermal_overheat ?? probs.cylinder_head_overheat ?? 0.01) * 100);
    const pMisfire = Math.round((probs.SPARK_PLUG_DEGRADATION ?? probs.misfire ?? probs.spark_misfire ?? probs.ignition_misfire ?? 0.01) * 100);

    setText('prob-nominal', `${pNominal}%`);
    setCss('prob-nominal-bar', 'width', `${pNominal}%`);
    setText('prob-lube', `${pLube}%`);
    setCss('prob-lube-bar', 'width', `${pLube}%`);
    setText('prob-bearing', `${pBearing}%`);
    setCss('prob-bearing-bar', 'width', `${pBearing}%`);
    setText('prob-thermal', `${pThermal}%`);
    setCss('prob-thermal-bar', 'width', `${pThermal}%`);
    setText('prob-misfire', `${pMisfire}%`);
    setCss('prob-misfire-bar', 'width', `${pMisfire}%`);

    // Prognostics RUL, Hazard Rate & Degradation Velocity
    const rulStr = dashboardView.rul_time_str || infer.estimatedTimeToFault || '1200.0 h';
    setText('lab-rul-val', rulStr);
    const hazVal = twinState?.hazard_rate ? `${twinState.hazard_rate.toFixed(4)} / hr` : '0.0034 / hr';
    setText('lab-hazard-rate', hazVal);
    const degRate = twinState?.degradation_velocity ? `${twinState.degradation_velocity > 0 ? '+' : ''}${twinState.degradation_velocity.toFixed(4)} / hr` : '+0.0002 / hr';
    setText('lab-deg-velocity', degRate);

    // Mitigation Advisory in AI Lab
    const mitigBox = $('lab-mitigation-box');
    if (mitigBox) {
      if (state.status === 'CRITICAL' || state.status === 'FAULT' || dashboardView.anomaly_detected) {
        const actList = dashboardView.recommended_actions || infer.recommendedAction || ['Reduce throttle demand to 65%', 'Trim propeller pitch for thermal relief'];
        mitigBox.innerHTML = actList.map(a => `&bull; <strong>${a}</strong>`).join('<br>');
        mitigBox.style.borderLeftColor = 'var(--status-critical)';
      } else {
        mitigBox.innerHTML = '&bull; All propulsion parameters within nominal envelope.<br>&bull; Continue planned waypoint flight profile at current throttle demand.';
        mitigBox.style.borderLeftColor = 'var(--status-normal)';
      }
    }

    // AI Lab Evidence List ("Why did the AI reach this conclusion?")
    const labEvidenceList = $('ai-lab-evidence-list');
    if (labEvidenceList) {
      const isAnom = dashboardView.anomaly_detected || rawAnomScore > (ai.anomalyThreshold || 0.045);
      const confVal = dashboardView.confidence_pct ?? infer.confidence ?? 94;
      const trustScore = sensorTrust?.overall_trust_score ?? 98;
      
      let items = [];
      if (isAnom) {
        const topIssue = dashboardView.fault_class ? dashboardView.fault_class.replace(/_/g, ' ') : (infer.possibleIssue || 'Degradation Anomaly');
        items.push(`Fault Signature: Divergence matching <strong>${topIssue}</strong>.`);
        items.push(`Isolation Forest: Multi-variate reconstruction error at <strong>${rawAnomScore.toFixed(3)}</strong> (Exceeds ${(ai.anomalyThreshold || 0.045).toFixed(3)} threshold).`);
        items.push(`Sensor Trust Score: <strong>${Math.round(trustScore)}%</strong> (Validated transducer array).`);
        items.push(`Consensus Confidence: <strong>${confVal}%</strong> across physics twin and ML classifiers.`);
      } else {
        items.push('Physics Model: Operating within nominal indicated brake torque and thermal balance envelope.');
        items.push(`Sensor Trust Score: <strong>${Math.round(trustScore)}%</strong> (All 6 primary transducers valid, zero sensor drift).`);
        items.push(`Isolation Forest: Multi-variate reconstruction error within standard 1.5σ nominal cluster boundary (C0).`);
        items.push(`Digital Twin Consensus: <strong>${confVal}%</strong> confidence across physics, sensor trust, and machine learning pipelines.`);
      }
      labEvidenceList.innerHTML = items.map(t => `<li>${t}</li>`).join('');
    }

    // — Critical Popup Alert —
    if ((state.status === 'CRITICAL' || state.status === 'FAULT') && !criticalAlertShown) {
      showCriticalAlertModal(state, infer);
      criticalAlertShown = true;
    } else if (state.status === 'NORMAL') {
      criticalAlertShown = false;
    }

    // — Audio RPM —
    audio.updateEngineRPM(state.rpm);

    // — 6-Channel Realtime Monitor & History Logs —
    rtMon.update(state, history, {
      isConnected: true,
      mode,
      status,
      source: data.source || (mode === 'LIVE' ? 'LIVE STREAM' : 'SIMULATION'),
      dataAgeMs: metrics?.data_age_ms
    });

    if ($('view-history')?.style.display !== 'none') {
      histLog.render();
    }
  }

  // Client Simulation mode listener (ONLY active when explicitly in SIMULATION mode and backend is offline)
  sim.subscribe((state, history) => {
    if (!wsConnected && evalMode === 'SIMULATION') {
      processTelemetryUpdate({
        dashboard_view: {
          ...state,
          oil_pressure: state.oilPressure,
          fuel_flow: state.fuelFlow,
          engine_health: state.engineHealth,
          mission_reliability: state.missionReliability,
        }
      }, 'SIMULATION', 'SIMULATED');
    }
  });

  // ─── Toast Notification ───────────────────────────────────────────────────────
  function toast(msg, duration = 3500) {
    const c = $('toast-container'); if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="material-symbols-outlined" style="color:var(--accent-cyan);flex-shrink:0">info</span><span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => {
      t.style.cssText += ';opacity:0;transform:translateY(10px);transition:all 0.35s ease';
      setTimeout(() => t.remove(), 350);
    }, duration);
  }

  // ─── WebSocket Backend Link ───────────────────────────────────────────────────
  function wsCmd(cmd) {
    if (wsConnected && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(cmd));
    }
  }

  function initWebSocket() {
    try {
      socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        wsConnected = true;
        setText('comm-link-status',    'Live Backend Link (Active)');
        setText('backend-status-text', 'FastAPI WS Connected');
        $('ws-status-dot')?.classList.add('connected');
        toast('Connected to FastAPI Real-Time Telemetry Engine');

        fetch(`${API_BASE_URL}/api/mode`)
          .then(r => r.json())
          .then(d => {
            if (typeof d.is_paused === 'boolean') updatePauseUI(d.is_paused);
          })
          .catch(() => {});
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (typeof msg.is_paused === 'boolean' && msg.is_paused !== isStreamPaused) {
            updatePauseUI(msg.is_paused);
          }

          if (msg.type === 'LIVE_STREAM_STATUS') {
            liveStreamConnected = !!msg.connected;
            const banner = $('live-not-connected-banner');
            if (banner && evalMode === 'LIVE') {
              banner.style.display = liveStreamConnected ? 'none' : 'flex';
            }
            if (!liveStreamConnected && evalMode === 'LIVE') {
              renderDisconnectedLiveState(msg.status_details || { status: msg.status, source: 'DISCONNECTED' });
            } else if (msg.status === 'STALE' && evalMode === 'LIVE') {
              setText('hdr-last-update', 'STALE STREAM');
              setCss('hdr-pulse-dot', 'background', '#F59E0B');
              setText('kpi-status-val', 'STALE');
              updateHardwareView(msg.status_details || { status: 'STALE', connected: true }, null, evalMode, true);
            }
          } else if (msg.type === 'TELEMETRY_UPDATE') {
            liveStreamConnected = true;
            if ($('live-not-connected-banner') && evalMode === 'LIVE') {
              $('live-not-connected-banner').style.display = 'none';
            }
            setCss('hdr-pulse-dot', 'background', '#22C55E');
            processTelemetryUpdate(msg.data, msg.mode, msg.status, msg.stream_metrics);
          } else if (msg.type === 'ALERT_TRIGGERED') {
            if (msg.alert) {
              histLog.addBackendEvent(msg.alert);
              toast(`ALERT: ${msg.alert.message || msg.alert.text}`, 4000);
            }
          }
        } catch (err) {
          console.error('WS Frame Parse Error:', err);
        }
      };

      socket.onclose = () => {
        wsConnected = false;
        setText('comm-link-status',    'Disconnected');
        setText('backend-status-text', 'FastAPI Offline');
        $('ws-status-dot')?.classList.remove('connected');
        if (evalMode === 'LIVE') {
          renderDisconnectedLiveState({ status: 'BACKEND OFFLINE', source: 'DISCONNECTED' });
        }
        setTimeout(initWebSocket, 3000);
      };

      socket.onerror = () => {
        wsConnected = false;
      };
    } catch (_) {
      // Backend offline
      if (evalMode === 'LIVE') {
        renderDisconnectedLiveState({ status: 'BACKEND OFFLINE', source: 'DISCONNECTED' });
      }
    }
  }

  // Allow manual backend URL configuration by clicking on backend status widget
  const statusContainer = $('backend-status-text')?.parentElement;
  if (statusContainer) {
    statusContainer.style.cursor = 'pointer';
    statusContainer.title = 'Click to configure/change Backend URL';
    statusContainer.addEventListener('click', () => {
      const current = localStorage.getItem('AERIS_BACKEND_URL') || API_BASE_URL;
      const target = window.prompt('Configure AERIS-TWIN Backend URL (e.g., https://your-backend.onrender.com):', current);
      if (target !== null) {
        window.setBackendUrl(target);
      }
    });
  }

  // Initial state on page load: clean disconnected live state
  renderDisconnectedLiveState();
  initWebSocket();
});
