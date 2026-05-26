import pathlib
import json 

path = pathlib.Path("data.json")
duration = 0

with open( path , 'r', encoding='utf-8' ) as f:
    data = json.load(f)
    for i, item in enumerate(data):
        duration += item["duration_sec"]
        if i % 100 == 0:
            print(f"Processed {i} items, total duration so far: {duration} seconds")
    
    duration = duration / 3600

print(f"Total duration of all videos: {duration} hours")