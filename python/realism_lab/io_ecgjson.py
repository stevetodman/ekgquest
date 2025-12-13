"""
ECG JSON I/O utilities for EKGQuest format.

Handles loading and saving ECG data in the canonical EKGQuest JSON schema.
"""

import json
import numpy as np
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, Optional, Any, List, Tuple


@dataclass
class ECGTargets:
    """Target/provenance metadata for synthetic ECGs."""
    synthetic: bool = True
    generator_version: str = ""
    age_years: float = 0.0
    dx: str = "Normal sinus"
    HR_bpm: float = 0.0
    PR_ms: int = 0
    QRS_ms: int = 0
    QT_ms: int = 0
    QTc_ms: int = 0
    axes_deg: Dict[str, float] = field(default_factory=dict)
    hrv: Dict[str, float] = field(default_factory=dict)
    device_mode: str = ""
    seed: Optional[int] = None


@dataclass
class ECGData:
    """
    Container for ECG data in EKGQuest format.

    Attributes:
        schema_version: ECG schema version
        fs: Sampling frequency in Hz
        duration_s: Duration in seconds
        leads_uV: Dictionary of lead name -> int16 array in microvolts
        targets: Synthesis target parameters (for synthetic ECGs)
        raw_json: Original JSON data (for passthrough)
    """
    schema_version: str
    fs: int
    duration_s: float
    leads_uV: Dict[str, np.ndarray]
    targets: Optional[ECGTargets] = None
    raw_json: Optional[Dict] = None

    @property
    def n_samples(self) -> int:
        """Number of samples in the recording."""
        if self.leads_uV:
            first_lead = next(iter(self.leads_uV.values()))
            return len(first_lead)
        return int(self.duration_s * self.fs)

    @property
    def lead_names(self) -> List[str]:
        """List of available lead names."""
        return list(self.leads_uV.keys())

    def get_lead_mv(self, lead: str) -> np.ndarray:
        """Get lead data in millivolts (float)."""
        if lead not in self.leads_uV:
            raise KeyError(f"Lead {lead} not found. Available: {self.lead_names}")
        return self.leads_uV[lead].astype(np.float64) / 1000.0

    def get_time_axis(self) -> np.ndarray:
        """Get time axis in seconds."""
        return np.arange(self.n_samples) / self.fs


def load_ecg_json(path: Path | str) -> ECGData:
    """
    Load ECG data from JSON file.

    Args:
        path: Path to ECG JSON file

    Returns:
        ECGData object with loaded data
    """
    path = Path(path)
    with open(path, 'r') as f:
        data = json.load(f)

    # Parse leads
    leads_uV = {}
    for lead_name, values in data.get('leads_uV', {}).items():
        if isinstance(values, dict):
            # JavaScript Int16Array serializes as {"0": v0, "1": v1, ...}
            n_samples = len(values)
            arr = [values[str(i)] for i in range(n_samples)]
            leads_uV[lead_name] = np.array(arr, dtype=np.int16)
        else:
            # Standard array format
            leads_uV[lead_name] = np.array(values, dtype=np.int16)

    # Parse targets if present
    targets = None
    if 'targets' in data:
        t = data['targets']
        targets = ECGTargets(
            synthetic=t.get('synthetic', True),
            generator_version=t.get('generator_version', ''),
            age_years=t.get('age_years', 0.0),
            dx=t.get('dx', 'Normal sinus'),
            HR_bpm=t.get('HR_bpm', 0.0),
            PR_ms=t.get('PR_ms', 0),
            QRS_ms=t.get('QRS_ms', 0),
            QT_ms=t.get('QT_ms', 0),
            QTc_ms=t.get('QTc_ms', 0),
            axes_deg=t.get('axes_deg', {}),
            hrv=t.get('hrv', {}),
            device_mode=t.get('device_mode', ''),
            seed=t.get('seed'),
        )

    return ECGData(
        schema_version=data.get('schema_version', '1.0'),
        fs=data.get('fs', 1000),
        duration_s=data.get('duration_s', 10.0),
        leads_uV=leads_uV,
        targets=targets,
        raw_json=data,
    )


def save_ecg_json(ecg: ECGData, path: Path | str) -> None:
    """
    Save ECG data to JSON file.

    Args:
        ecg: ECGData object to save
        path: Output path
    """
    path = Path(path)

    # Build JSON structure
    data = {
        'schema_version': ecg.schema_version,
        'fs': ecg.fs,
        'duration_s': ecg.duration_s,
        'leads_uV': {
            name: values.tolist()
            for name, values in ecg.leads_uV.items()
        },
    }

    # Add targets if present
    if ecg.targets:
        data['targets'] = {
            'synthetic': ecg.targets.synthetic,
            'generator_version': ecg.targets.generator_version,
            'age_years': ecg.targets.age_years,
            'dx': ecg.targets.dx,
            'HR_bpm': ecg.targets.HR_bpm,
            'PR_ms': ecg.targets.PR_ms,
            'QRS_ms': ecg.targets.QRS_ms,
            'QT_ms': ecg.targets.QT_ms,
            'QTc_ms': ecg.targets.QTc_ms,
            'axes_deg': ecg.targets.axes_deg,
            'hrv': ecg.targets.hrv,
            'device_mode': ecg.targets.device_mode,
        }
        if ecg.targets.seed is not None:
            data['targets']['seed'] = ecg.targets.seed

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def load_ecg_directory(directory: Path | str) -> List[Tuple[ECGData, str]]:
    """
    Load all ECG JSON files from a directory.

    Args:
        directory: Path to directory containing ECG JSON files

    Returns:
        List of (ECGData, filename) tuples
    """
    directory = Path(directory)
    ecgs = []
    for path in sorted(directory.glob('*.json')):
        # Skip non-ECG files like manifest.json
        if path.name in ('manifest.json',):
            continue
        try:
            ecg = load_ecg_json(path)
            # Skip files without lead data (not valid ECGs)
            if not ecg.leads_uV:
                print(f"Warning: Skipping {path.name} (no lead data)")
                continue
            ecgs.append((ecg, path.name))
        except Exception as e:
            print(f"Warning: Failed to load {path}: {e}")
    return ecgs
