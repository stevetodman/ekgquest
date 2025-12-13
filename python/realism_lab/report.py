"""
Report generation for realism evaluation results.

Generates HTML and text reports from evaluation results.
"""

import json
from pathlib import Path
from typing import Optional
from datetime import datetime

from .eval_realism import EvaluationResult, GateResult


HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>EKGQuest Realism Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .header h1 { margin: 0 0 10px 0; }
        .header .meta { opacity: 0.9; font-size: 14px; }
        .card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .card h2 {
            margin-top: 0;
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
        }
        .status-pass {
            color: #22c55e;
            font-weight: bold;
        }
        .status-fail {
            color: #ef4444;
            font-weight: bold;
        }
        .gate {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            border-bottom: 1px solid #eee;
        }
        .gate:last-child { border-bottom: none; }
        .gate-name { font-weight: 500; }
        .gate-stat {
            font-family: monospace;
            color: #666;
        }
        .progress-bar {
            width: 200px;
            height: 8px;
            background: #eee;
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: #22c55e;
            transition: width 0.3s;
        }
        .progress-fill.warning { background: #f59e0b; }
        .progress-fill.danger { background: #ef4444; }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        th { background: #f9fafb; font-weight: 600; }
        .metric-value {
            font-family: monospace;
            font-size: 14px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        .summary-item {
            background: #f9fafb;
            padding: 15px;
            border-radius: 6px;
            text-align: center;
        }
        .summary-item .value {
            font-size: 24px;
            font-weight: bold;
            color: #374151;
        }
        .summary-item .label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>EKGQuest Realism Report</h1>
        <div class="meta">
            Generated: {timestamp}<br>
            Cases: {cases_dir}
        </div>
    </div>

    <div class="card">
        <h2>Overall Result</h2>
        <div class="summary-grid">
            <div class="summary-item">
                <div class="value {overall_class}">{overall_status}</div>
                <div class="label">Status</div>
            </div>
            <div class="summary-item">
                <div class="value">{n_cases}</div>
                <div class="label">Total Cases</div>
            </div>
            <div class="summary-item">
                <div class="value">{n_passed}</div>
                <div class="label">Passed</div>
            </div>
            <div class="summary-item">
                <div class="value">{pass_rate:.1f}%</div>
                <div class="label">Pass Rate</div>
            </div>
        </div>
    </div>

    <div class="card">
        <h2>Quality Gates</h2>
        {gates_html}
    </div>

    <div class="card">
        <h2>Summary by Age Group</h2>
        {age_table_html}
    </div>

    <div class="card">
        <h2>Summary by Diagnosis</h2>
        {dx_table_html}
    </div>

    {failures_html}

    <div class="card" style="background: #f9fafb; font-size: 12px; color: #666;">
        <strong>EKGQuest Realism Lab</strong> - Automated synthetic ECG quality assurance<br>
        For educational use only. Not for clinical diagnosis.
    </div>
</body>
</html>
"""


def generate_gate_html(gate: GateResult) -> str:
    """Generate HTML for a single gate."""
    status_class = "status-pass" if gate.passed else "status-fail"
    status_icon = "✓" if gate.passed else "✗"

    fill_class = ""
    if gate.pass_rate < 70:
        fill_class = "danger"
    elif gate.pass_rate < 90:
        fill_class = "warning"

    return f"""
    <div class="gate">
        <span class="gate-name">
            <span class="{status_class}">{status_icon}</span>
            {gate.name}
        </span>
        <div class="progress-bar">
            <div class="progress-fill {fill_class}" style="width: {gate.pass_rate}%"></div>
        </div>
        <span class="gate-stat">{gate.n_passed}/{gate.n_cases} ({gate.pass_rate:.1f}%)</span>
    </div>
    """


def generate_table_html(data: dict, key_header: str, value_headers: list) -> str:
    """Generate an HTML table from dictionary data."""
    if not data:
        return "<p>No data available</p>"

    rows = []
    for key, values in sorted(data.items()):
        row = f"<tr><td>{key}</td>"
        for h in value_headers:
            if h in values:
                v = values[h]
                if isinstance(v, float):
                    row += f'<td class="metric-value">{v:.1f}</td>'
                else:
                    row += f'<td class="metric-value">{v}</td>'
            else:
                row += "<td>-</td>"
        row += "</tr>"
        rows.append(row)

    headers = f"<th>{key_header}</th>" + "".join(f"<th>{h}</th>" for h in value_headers)

    return f"""
    <table>
        <thead><tr>{headers}</tr></thead>
        <tbody>{"".join(rows)}</tbody>
    </table>
    """


def generate_report(result: EvaluationResult, output_path: Optional[Path] = None) -> str:
    """
    Generate HTML report from evaluation result.

    Args:
        result: EvaluationResult from run_evaluation
        output_path: Optional path to save HTML file

    Returns:
        HTML string
    """
    # Generate gates HTML
    gates_html = "\n".join(generate_gate_html(g) for g in result.gates)

    # Generate age table
    age_data = result.summary.get("by_age_bin", {})
    age_table_html = generate_table_html(
        age_data,
        "Age Group",
        ["n_cases", "n_passed", "pass_rate"]
    )

    # Generate dx table
    dx_data = result.summary.get("by_dx", {})
    dx_table_html = generate_table_html(
        dx_data,
        "Diagnosis",
        ["n_cases", "n_passed", "pass_rate"]
    )

    # Generate failures section
    failures_html = ""
    failed_cases = [r for r in result.case_results if not r.passed][:20]
    if failed_cases:
        failure_rows = []
        for r in failed_cases:
            failures_str = "<br>".join(r.failures[:3])
            if len(r.failures) > 3:
                failures_str += f"<br>... and {len(r.failures) - 3} more"
            failure_rows.append(f"""
                <tr>
                    <td>{r.filename}</td>
                    <td>{r.age_years:.1f}</td>
                    <td>{r.dx}</td>
                    <td style="font-size: 12px">{failures_str}</td>
                </tr>
            """)

        failures_html = f"""
        <div class="card">
            <h2>Failed Cases (first 20)</h2>
            <table>
                <thead><tr><th>File</th><th>Age</th><th>Diagnosis</th><th>Failures</th></tr></thead>
                <tbody>{"".join(failure_rows)}</tbody>
            </table>
        </div>
        """

    # Fill template
    html = HTML_TEMPLATE.format(
        timestamp=result.timestamp,
        cases_dir=result.cases_dir,
        overall_status="PASS" if result.overall_passed else "FAIL",
        overall_class="status-pass" if result.overall_passed else "status-fail",
        n_cases=result.n_cases,
        n_passed=result.n_passed,
        pass_rate=result.pass_rate,
        gates_html=gates_html,
        age_table_html=age_table_html,
        dx_table_html=dx_table_html,
        failures_html=failures_html,
    )

    if output_path:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w') as f:
            f.write(html)

    return html


def generate_text_report(result: EvaluationResult) -> str:
    """Generate plain text report from evaluation result."""
    lines = [
        "=" * 60,
        "EKGQUEST REALISM EVALUATION REPORT",
        "=" * 60,
        "",
        f"Timestamp: {result.timestamp}",
        f"Cases dir: {result.cases_dir}",
        "",
        f"Total cases: {result.n_cases}",
        f"Passed: {result.n_passed}",
        f"Pass rate: {result.pass_rate:.1f}%",
        f"Overall: {'PASS' if result.overall_passed else 'FAIL'}",
        "",
        "-" * 60,
        "QUALITY GATES",
        "-" * 60,
    ]

    for gate in result.gates:
        status = "✓" if gate.passed else "✗"
        lines.append(f"  {status} {gate.name}: {gate.pass_rate:.1f}% ({gate.n_passed}/{gate.n_cases})")

    lines.extend([
        "",
        "-" * 60,
        "BY AGE GROUP",
        "-" * 60,
    ])

    for bin_name, stats in sorted(result.summary.get("by_age_bin", {}).items()):
        lines.append(f"  {bin_name}: {stats['pass_rate']:.1f}% ({stats['n_passed']}/{stats['n_cases']})")

    lines.extend([
        "",
        "-" * 60,
        "BY DIAGNOSIS",
        "-" * 60,
    ])

    for dx, stats in sorted(result.summary.get("by_dx", {}).items()):
        lines.append(f"  {dx}: {stats['pass_rate']:.1f}% ({stats['n_passed']}/{stats['n_cases']})")

    if result.summary.get("metrics_summary"):
        lines.extend([
            "",
            "-" * 60,
            "METRICS SUMMARY",
            "-" * 60,
        ])
        for metric, stats in result.summary["metrics_summary"].items():
            if "mean" in stats:
                lines.append(f"  {metric}: mean={stats['mean']:.1f}, std={stats.get('std', 0):.1f}")

    return "\n".join(lines)
