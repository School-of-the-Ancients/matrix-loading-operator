import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedMove,planPath,segmentClear} from '../src/citizens_navigation.js';

const wall={id:'wall',cx:0,cz:0,halfX:.12,halfZ:.7,yawRadians:0};
const radius=.18;

function verifyMoves(start,result,obstacles,actorRadius){
  assert.equal(result.ok,true,result.reason);
  let from=start,moves=0;
  for(const waypoint of result.waypoints){
    const length=Math.hypot(waypoint.x-from.x,waypoint.z-from.z);
    const count=Math.ceil(length/.28-1e-9);
    for(let step=1;step<=count;step++){
      const to={x:from.x+(waypoint.x-from.x)*step/count,
        z:from.z+(waypoint.z-from.z)*step/count};
      const previous={x:from.x+(waypoint.x-from.x)*(step-1)/count,
        z:from.z+(waypoint.z-from.z)*(step-1)/count};
      assert.deepEqual(checkedMove({from:previous,to,obstacles,actorRadius}),{ok:true});
      moves++;
    }
    from=waypoint;
  }
  assert.equal(moves,result.movesRequired);
  assert.ok(moves<=60);
}

test('routes around a wall and checks each finite MatrixWorld step',()=>{
  const start={x:-1,z:0},goal={x:1,z:0};
  assert.equal(segmentClear(start,goal,[wall],radius),false);
  const route=planPath({start,goal,obstacles:[wall],actorRadius:radius});
  assert.ok(route.waypoints.length>=2);
  assert.deepEqual(route.waypoints.at(-1),goal);
  verifyMoves(start,route,[wall],radius);
});

test('returns the blocking object for an inaccessible destination',()=>{
  const result=planPath({start:{x:-1,z:0},goal:{x:0,z:0},
    obstacles:[wall],actorRadius:radius});
  assert.equal(result.ok,false);
  assert.equal(result.code,'goal_blocked');
  assert.match(result.reason,/wall/);
});

test('uses rotated object geometry instead of an axis-aligned shortcut',()=>{
  const diagonal={id:'diagonal',cx:0,cz:0,halfX:.9,halfZ:.1,
    yawRadians:Math.PI/4};
  const start={x:-1,z:0},goal={x:1,z:0};
  assert.equal(segmentClear(start,goal,[diagonal],radius),false);
  verifyMoves(start,planPath({start,goal,obstacles:[diagonal],actorRadius:radius}),
    [diagonal],radius);
});

test('diagonal grid neighbors cannot cut through adjacent obstacle corners',()=>{
  const obstacles=[
    {id:'north',cx:0,cz:.2,halfX:.09,halfZ:.09,yawRadians:0},
    {id:'east',cx:.2,cz:0,halfX:.09,halfZ:.09,yawRadians:0}
  ];
  const start={x:0,z:0},goal={x:.2,z:.2},actorRadius=.05;
  assert.equal(segmentClear(start,goal,obstacles,actorRadius),false);
  const route=planPath({start,goal,obstacles,actorRadius});
  verifyMoves(start,route,obstacles,actorRadius);
  assert.ok(route.lengthMeters>Math.hypot(.2,.2));
});

test('corner clearance uses the circular actor radius, including at floor edges',()=>{
  const box={id:'box',cx:0,cz:0,halfX:.5,halfZ:.5,yawRadians:0};
  assert.equal(segmentClear({x:.7,z:.7},{x:.7,z:.7},[box],.25),true);
  assert.equal(segmentClear({x:.65,z:.65},{x:.65,z:.65},[box],.25),false);
  const edge=checkedMove({from:{x:99.7,z:0},to:{x:99.9,z:0},
    obstacles:[],actorRadius:.2});
  assert.equal(edge.code,'floor_limit');
});

test('same geometry yields the same route independent of obstacle array order',()=>{
  const other={id:'side-block',cx:1.2,cz:1.2,halfX:.2,halfZ:.2,
    yawRadians:.35};
  const start={x:-1,z:0},goal={x:1,z:0};
  const first=planPath({start,goal,obstacles:[other,wall],actorRadius:radius});
  const second=planPath({start,goal,obstacles:[wall,other],actorRadius:radius});
  assert.deepEqual(first,second);
});

test('route and individual movement limits fail explicitly',()=>{
  const start={x:0,z:0},goal={x:2,z:0};
  const route=planPath({start,goal,obstacles:[],actorRadius:radius,maxMoves:3});
  assert.equal(route.ok,false);
  assert.equal(route.code,'path_limit');
  const step=checkedMove({from:start,to:goal,obstacles:[],actorRadius:radius});
  assert.equal(step.ok,false);
  assert.equal(step.code,'step_limit');
});
