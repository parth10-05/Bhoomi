import json, os
files = ['predictions_output.json','anomalies_output.json','carbon_output.json','report_context.json','prescriptions_output.json']
for f in files:
    path = os.path.join("output", f)
    try:
        d = json.load(open(path))
        items = d.get('grids', d.get('prescriptions', []))
        print(f"{f}: OK  ({len(items)} items)")
    except Exception as e:
        print(f"{f}: ERROR - {e}")
