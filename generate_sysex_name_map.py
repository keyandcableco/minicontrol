import json

# Load parameters.json
with open('parameters.json', 'r') as f:
    parameters = json.load(f)

sysex_name_map = {}

# What the knobs, hover or the double tap can be pointed at: each setting says so in its
# "controls", from the firmware ("all", the default, "tap" for the double tap only, or
# "none"). generate.py narrows each list to what its own control may move.
def is_target(param):
    return param.get('controls', 'all') != 'none'

# Loop through all top-level parameter groups. A hidden setting has no control on the page, but
# one a control may take (the looper, for the double tap) is listed by its name alone.
for group_name, params in parameters.items():
    readable_group = group_name.replace('_parameter', '')
    for param in params:
        sysex = param.get('sysex_adress')
        name = param.get('name')
        group = param.get('group')
        if (
            isinstance(sysex, int) and
            is_target(param) and
            name and name.strip()
        ):
            # Use group if available; fallback to sysex address
            if group_name == 'hidden':
                label = name
            elif group and group.lower() != 'hidden':
                label = f"{readable_group}: {group.lower()}: {name}"
            else:
                label = f"{readable_group}: {name} ({sysex})"
            sysex_name_map[str(sysex)] = label

# Sort sysex_name_map by value (label) alphabetically
sorted_sysex_name_map = dict(sorted(sysex_name_map.items(), key=lambda x: x[1].lower()))

# Save to sysex_name_map.json
with open('sysex_name_map.json', 'w') as f:
    json.dump(sorted_sysex_name_map, f, indent=2)

print("Generated sysex_name_map.json")