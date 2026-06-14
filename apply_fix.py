import pathlib
import json 

path = pathlib.Path("data.json")
path_done = pathlib.Path('done_download.json')
duration = 0

done_ids:list = []

with open( path , 'r', encoding='utf-8' ) as f, open(path_done, 'r', encoding='utf-8') as f_d:
    done = json.load(f_d)
    data = json.load(f)
    for item in done:
        print(item)
        if isinstance(item, list):
            done_ids = item.
            print(item)

    print(done_ids[:10])
    
    duration = duration / 3600

print(f"Total duration of all videos: {duration} hours")