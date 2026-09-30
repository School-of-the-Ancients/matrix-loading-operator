#!/usr/bin/env python3
"""Matched prompt assembly samples. This does not measure speech/model/headset latency."""
import argparse
import ast
import copy
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'ControlService'))
from agent_portal import build_matrix_turn_message

BASELINE='9453ef06b1873937822c1cf985115f05f72e1e20'
REQUESTS=['Load a chair here','Move this left','Rotate this 45 degrees',
          'Make it twice as big','Create a curved bench','Put this here',
          'Put this on my measured table','Put this on my table with tracking unavailable']
TOOLS=('matrix_scene_summary','matrix_inspect_entity','matrix_move_object',
       'matrix_list_assets','matrix_list_entities','matrix_list_procedural_generators',
       'matrix_room_spatial_context','matrix_spawn_on_surface','matrix_move_with_room_constraint')

def context(index):
    pose={'position':{'x':0,'y':0,'z':0},'rotation':{'x':0,'y':0,'z':0},'scale':{'x':1,'y':1,'z':1}}
    result={'kind':'matrix_spatial_context','schemaVersion':1,'online':True,
        'roomId':'web-virtual-room-v1','sceneRevision':1,'runtimeGeneration':1,
        'runtimeDescriptor':{'schemaVersion':1,'client':'matrix-web','renderer':'threejs-webxr',
                             'presentation':'desktop'},
        'creatorMode':{'mode':'creator','simulation':'paused','revision':0},
        'capabilityVersions':{'entityActionSchemaVersion':1,'rigidSchemaVersion':1},
        'assetCatalogCount':4,'proceduralGeneratorCount':3,
        'selectedObject':{'objectId':'chair-1','assetId':'chair','anchorId':'web-floor','transform':pose},
        'selectedPlacement':{'anchorId':'web-floor','position':{'x':1,'y':0,'z':-1},'source':'raycast'},
        'viewerFrame':{'anchorId':'web-floor','position':{'x':0,'y':1.6,'z':2},'forward':{'x':0,'y':0,'z':-1}},
        'sceneSummary':{'objectCount':30,'omittedObjectCount':22,'objects':[
            {'objectId':f'object-{n}','assetId':'chair','anchorId':'web-floor','transform':copy.deepcopy(pose)}
            for n in range(8)]},
        'room':{'mode':'white-room','state':'ready','alignmentVerified':False,'readOnly':False}}
    if index>=6:
        result['runtimeDescriptor']['presentation']='ar'
        result['room']={'mode':'ar','state':'ready','alignmentVerified':index==6,'readOnly':index!=6}
        result['selectedPlacement']['anchorId']='table-1'
        result['roomSpatial']={'schemaVersion':1,'usable':index==6,'planeCount':40,
            'omittedPlaneCount':32,'unusableReason':None if index==6 else 'stale-tracking',
            'planes':[{'anchorId':f'table-{n}','kind':'support','semanticLabels':['TABLE'],
                'boundary':[{'x':i/10,'y':0,'z':i/20} for i in range(16)],
                'spatialToken':'a'*64} for n in range(8)]}
    return result

def quantile(samples,p):
    ordered=sorted(samples)
    return ordered[min(len(ordered)-1,int((len(ordered)-1)*p+.5))]

def benchmark(builder,n):
    rows=[]
    for index,prompt in enumerate(REQUESTS):
        data=context(index);samples=[]
        for _ in range(n):
            started=time.perf_counter_ns();message=builder(prompt,data,TOOLS)
            samples.append((time.perf_counter_ns()-started)/1e6)
        rows.append({'request':prompt,'samples':n,'failures':0,'retries':0,
            'promptBytes':len(message.encode()),'inputContextBytes':len(json.dumps(data,separators=(',',':')).encode()),
            'p50AssemblyMs':quantile(samples,.5),'p95AssemblyMs':quantile(samples,.95),'rawAssemblyMs':samples})
    return rows

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--samples',type=int,default=60);args=parser.parse_args()
    if not 20<=args.samples<=1000:parser.error('Use 20–1000 samples per workload')
    source=subprocess.check_output(['git','show',BASELINE+':ControlService/agent_portal.py'],cwd=ROOT,text=True)
    node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='build_matrix_turn_message')
    namespace={'json':json,'re':re};exec(compile(ast.Module(body=[node],type_ignores=[]),'<v1.1 prompt builder>','exec'),namespace)
    report={'schemaVersion':1,'scope':'prompt assembly only; synthetic bounded desktop/AR observations',
        'baselineCommit':BASELINE,'candidateCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'candidateDirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)),
        'runtime':platform.python_version(),'platform':platform.platform(),'sceneObjects':30,
        'coldWarm':'warm assembly; each matched implementation uses the same synthetic contexts',
        'model':None,'reasoning':None,'toolCalls':'unmeasured; no inference or runtime actions executed',
        'submissionToVisibleEdit':'unmeasured; cloud live AI and physical headset acceptance remain pending',
        'baseline':benchmark(namespace['build_matrix_turn_message'],args.samples),
        'candidate':benchmark(build_matrix_turn_message,args.samples)}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n')
    print('Wrote',args.output,'with',args.samples,'samples per workload and implementation')
if __name__=='__main__':main()
