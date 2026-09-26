// Deterministic, bounded virtual-floor navigation geometry. This module does
// not mutate MatrixWorld; its caller must still execute and observe each move.
const GRID_METRES=.2;
const MOVE_METRES=.28;
const MAX_MOVES=60;
const MAX_SPAN_METRES=16;
const MAX_GRID_NODES=10000;
const MAX_OBSTACLES=100;
const FLOOR_HALF_METRES=100;
const EPS=1e-9;
const NEIGHBORS=[[-1,0],[0,-1],[0,1],[1,0],[-1,-1],[-1,1],[1,-1],[1,1]];

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const point=value=>value&&finite(value.x)&&finite(value.z)&&
  Math.abs(value.x)<=100&&Math.abs(value.z)<=100;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const failure=(code,reason)=>({ok:false,code,reason});
const insideFloor=(position,actorRadius)=>
  Math.abs(position.x)<=FLOOR_HALF_METRES-actorRadius+EPS&&
  Math.abs(position.z)<=FLOOR_HALF_METRES-actorRadius+EPS;

function checkedGeometry(start,goal,obstacles,actorRadius){
  if(!point(start)||!point(goal)||!finite(actorRadius)||actorRadius<0||
    actorRadius>5||!Array.isArray(obstacles)||obstacles.length>MAX_OBSTACLES)
    throw Error('Invalid navigation input');
  const ids=new Set();
  const checked=[];
  for(const obstacle of obstacles){
    if(!obstacle||typeof obstacle.id!=='string'||!obstacle.id||
      obstacle.id.length>128||ids.has(obstacle.id)||
      !finite(obstacle.cx)||!finite(obstacle.cz)||
      !finite(obstacle.halfX)||!finite(obstacle.halfZ)||
      obstacle.halfX<=0||obstacle.halfZ<=0||
      obstacle.halfX>20||obstacle.halfZ>20||
      !finite(obstacle.yawRadians))throw Error('Invalid navigation obstacle');
    ids.add(obstacle.id);
    checked.push({...obstacle,cos:Math.cos(obstacle.yawRadians),
      sin:Math.sin(obstacle.yawRadians)});
  }
  return checked.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

function local(point,obstacle){
  const dx=point.x-obstacle.cx,dz=point.z-obstacle.cz;
  return {x:dx*obstacle.cos+dz*obstacle.sin,
    z:-dx*obstacle.sin+dz*obstacle.cos};
}

function intersectsRectangle(a,b,halfX,halfZ){
  let first=0,last=1;
  for(const [axis,half] of [['x',halfX],['z',halfZ]]){
    const delta=b[axis]-a[axis];
    if(Math.abs(delta)<EPS){
      if(a[axis]<-half||a[axis]>half)return false;
      continue;
    }
    let enter=(-half-a[axis])/delta,leave=(half-a[axis])/delta;
    if(enter>leave)[enter,leave]=[leave,enter];
    first=Math.max(first,enter);last=Math.min(last,leave);
    if(first>last+EPS)return false;
  }
  return true;
}

function pointRectangleDistanceSquared(p,halfX,halfZ){
  const dx=Math.max(Math.abs(p.x)-halfX,0);
  const dz=Math.max(Math.abs(p.z)-halfZ,0);
  return dx*dx+dz*dz;
}

function pointSegmentDistanceSquared(p,a,b){
  const dx=b.x-a.x,dz=b.z-a.z,lengthSquared=dx*dx+dz*dz;
  const t=lengthSquared>0?Math.max(0,Math.min(1,
    ((p.x-a.x)*dx+(p.z-a.z)*dz)/lengthSquared)):0;
  const x=a.x+t*dx-p.x,z=a.z+t*dz-p.z;
  return x*x+z*z;
}

// Exact Euclidean segment distance to the uninflated oriented rectangle.
// Comparing it with the actor radius gives circular clearance at corners,
// rather than the overly broad square made by merely expanding half-extents.
function blocker(from,to,obstacles,actorRadius){
  for(const obstacle of obstacles){
    const a=local(from,obstacle),b=local(to,obstacle);
    const {halfX,halfZ}=obstacle;
    if(intersectsRectangle(a,b,halfX,halfZ))return obstacle.id;
    let distanceSquared=Math.min(pointRectangleDistanceSquared(a,halfX,halfZ),
      pointRectangleDistanceSquared(b,halfX,halfZ));
    for(const x of [-halfX,halfX])for(const z of [-halfZ,halfZ])
      distanceSquared=Math.min(distanceSquared,
        pointSegmentDistanceSquared({x,z},a,b));
    if(distanceSquared<=actorRadius*actorRadius+EPS)return obstacle.id;
  }
  return null;
}

export function segmentClear(from,to,obstacles,actorRadius){
  const checked=checkedGeometry(from,to,obstacles,actorRadius);
  return blocker(from,to,checked,actorRadius)===null;
}

// Validate the actual proposed MatrixWorld movement after any rounding. A
// route is guidance; every finite executor step must still pass this check.
export function checkedMove({from,to,obstacles,actorRadius}){
  let checked;
  try{checked=checkedGeometry(from,to,obstacles,actorRadius);}
  catch(error){return failure('invalid_geometry',error.message);}
  if(!insideFloor(from,actorRadius)||!insideFloor(to,actorRadius))
    return failure('floor_limit','Navigation move leaves the virtual floor clearance');
  if(distance(from,to)>MOVE_METRES+EPS)
    return failure('step_limit','Navigation move exceeds 0.28 metres');
  const blockedBy=blocker(from,to,checked,actorRadius);
  if(blockedBy)return failure('obstacle',`Navigation move intersects ${blockedBy}`);
  return {ok:true};
}

class MinHeap {
  constructor(){this.values=[];}
  static less(a,b){return a.f<b.f-EPS||Math.abs(a.f-b.f)<=EPS&&
    (a.h<b.h-EPS||Math.abs(a.h-b.h)<=EPS&&a.id<b.id);}
  push(value){
    const items=this.values;items.push(value);
    for(let i=items.length-1;i>0;){
      const parent=(i-1)>>1;
      if(!MinHeap.less(items[i],items[parent]))break;
      [items[i],items[parent]]=[items[parent],items[i]];i=parent;
    }
  }
  pop(){
    const items=this.values,result=items[0],last=items.pop();
    if(items.length){
      items[0]=last;
      for(let i=0;;){
        const left=2*i+1,right=left+1;
        let first=i;
        if(left<items.length&&MinHeap.less(items[left],items[first]))first=left;
        if(right<items.length&&MinHeap.less(items[right],items[first]))first=right;
        if(first===i)break;
        [items[i],items[first]]=[items[first],items[i]];i=first;
      }
    }
    return result;
  }
  peek(){return this.values[0];}
  get length(){return this.values.length;}
}

function successfulPath(points,obstacles,actorRadius,maxMoves){
  const waypoints=[];
  for(let at=0;at<points.length-1;){
    let far=points.length-1;
    while(far>at+1&&blocker(points[at],points[far],obstacles,actorRadius))far--;
    if(blocker(points[at],points[far],obstacles,actorRadius))
      return failure('no_path','No clearance-preserving route exists');
    waypoints.push(points[far]);at=far;
  }
  let movesRequired=0,lengthMeters=0,from=points[0];
  for(const to of waypoints){
    const length=distance(from,to);
    lengthMeters+=length;
    movesRequired+=Math.ceil(length/MOVE_METRES-EPS);
    from=to;
  }
  if(movesRequired>maxMoves)
    return failure('path_limit',`Route requires ${movesRequired} moves; limit is ${maxMoves}`);
  return {ok:true,waypoints,movesRequired,lengthMeters};
}

// A* uses a local world-aligned grid, then removes unnecessary bends with the
// same exact swept-clearance check used for individual moves. The grid and
// expansion caps make failure explicit even in large saved scenes.
export function planPath({start,goal,obstacles,actorRadius,maxMoves=MAX_MOVES}){
  let checked;
  try{
    checked=checkedGeometry(start,goal,obstacles,actorRadius);
    if(!Number.isInteger(maxMoves)||maxMoves<1||maxMoves>MAX_MOVES)
      throw Error('Invalid navigation move limit');
  }catch(error){return failure('invalid_geometry',error.message);}
  if(!insideFloor(start,actorRadius)||!insideFloor(goal,actorRadius))
    return failure('floor_limit','Navigation endpoint lacks virtual floor clearance');
  const startBlocker=blocker(start,start,checked,actorRadius);
  if(startBlocker)return failure('start_blocked',`Start overlaps ${startBlocker}`);
  const goalBlocker=blocker(goal,goal,checked,actorRadius);
  if(goalBlocker)return failure('goal_blocked',`Destination overlaps ${goalBlocker}`);
  if(distance(start,goal)<=EPS)return {ok:true,waypoints:[],movesRequired:0,lengthMeters:0};
  if(!blocker(start,goal,checked,actorRadius))
    return successfulPath([start,goal],checked,actorRadius,maxMoves);

  const spanX=Math.abs(start.x-goal.x),spanZ=Math.abs(start.z-goal.z);
  if(spanX>MAX_SPAN_METRES||spanZ>MAX_SPAN_METRES)
    return failure('search_limit','Navigation endpoints exceed the 16 metre search span');
  const padX=Math.min(2,(MAX_SPAN_METRES-spanX)/2);
  const padZ=Math.min(2,(MAX_SPAN_METRES-spanZ)/2);
  const minX=Math.floor((Math.min(start.x,goal.x)-padX)/GRID_METRES)*GRID_METRES;
  const maxX=Math.ceil((Math.max(start.x,goal.x)+padX)/GRID_METRES)*GRID_METRES;
  const minZ=Math.floor((Math.min(start.z,goal.z)-padZ)/GRID_METRES)*GRID_METRES;
  const maxZ=Math.ceil((Math.max(start.z,goal.z)+padZ)/GRID_METRES)*GRID_METRES;
  const width=Math.round((maxX-minX)/GRID_METRES)+1;
  const height=Math.round((maxZ-minZ)/GRID_METRES)+1;
  const count=width*height;
  if(count>MAX_GRID_NODES)
    return failure('search_limit','Navigation grid exceeds the 10000-node limit');
  const index=(x,z)=>z*width+x;
  const gridPoint=id=>({x:minX+(id%width)*GRID_METRES,
    z:minZ+Math.floor(id/width)*GRID_METRES});
  const free=new Int8Array(count);
  const clearCell=id=>{
    if(free[id]===0){
      const position=gridPoint(id);
      free[id]=insideFloor(position,actorRadius)&&
        !blocker(position,position,checked,actorRadius)?1:-1;
    }
    return free[id]===1;
  };
  const scores=new Float64Array(count).fill(Infinity);
  const parents=new Int32Array(count).fill(-1);
  const closed=new Uint8Array(count);
  const heap=new MinHeap();
  const startX=Math.round((start.x-minX)/GRID_METRES);
  const startZ=Math.round((start.z-minZ)/GRID_METRES);
  for(let z=Math.max(0,startZ-3);z<=Math.min(height-1,startZ+3);z++)
    for(let x=Math.max(0,startX-3);x<=Math.min(width-1,startX+3);x++){
      const id=index(x,z),p=gridPoint(id),cost=distance(start,p);
      if(cost>GRID_METRES*3.5||!clearCell(id)||
        blocker(start,p,checked,actorRadius))continue;
      scores[id]=cost;
      const h=distance(p,goal);
      heap.push({id,g:cost,h,f:cost+h});
    }
  if(!heap.length)return failure('no_path','No clear grid entry from the start');

  let bestGoal=Infinity,goalParent=-1,expanded=0;
  while(heap.length){
    if(heap.peek().f>bestGoal-EPS)break;
    const current=heap.pop(),id=current.id;
    if(closed[id]||current.g>scores[id]+EPS)continue;
    closed[id]=1;
    if(++expanded>MAX_GRID_NODES)
      return failure('search_limit','Navigation search exceeded its node limit');
    const p=gridPoint(id),remaining=distance(p,goal);
    if(remaining<=GRID_METRES*3.5&&
      !blocker(p,goal,checked,actorRadius)&&
      scores[id]+remaining<bestGoal-EPS){
      bestGoal=scores[id]+remaining;goalParent=id;
    }
    const x=id%width,z=Math.floor(id/width);
    for(const [dx,dz] of NEIGHBORS){
      const nx=x+dx,nz=z+dz;
      if(nx<0||nx>=width||nz<0||nz>=height)continue;
      const neighbor=index(nx,nz);
      if(closed[neighbor]||!clearCell(neighbor))continue;
      if(dx&&dz&&(!clearCell(index(x+dx,z))||
        !clearCell(index(x,z+dz))))continue;
      const next=gridPoint(neighbor);
      if(blocker(p,next,checked,actorRadius))continue;
      const g=scores[id]+distance(p,next);
      if(g>=scores[neighbor]-EPS)continue;
      scores[neighbor]=g;parents[neighbor]=id;
      const h=distance(next,goal);
      heap.push({id:neighbor,g,h,f:g+h});
    }
  }
  if(goalParent<0)return failure('no_path','No clearance-preserving route exists');
  const middle=[];
  for(let id=goalParent;id>=0;id=parents[id])middle.push(gridPoint(id));
  middle.reverse();
  return successfulPath([start,...middle,goal],checked,actorRadius,maxMoves);
}
