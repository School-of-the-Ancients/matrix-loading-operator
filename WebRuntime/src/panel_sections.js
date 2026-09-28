const SECTION_STATE_KEY='matrix:web:panel-sections:v1';

export function initializePanelSections(root,storage){
  const sections=[...root.querySelectorAll('details.panel-section[id]')];
  let saved={};
  try{
    const value=JSON.parse(storage.getItem(SECTION_STATE_KEY)||'{}');
    if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;
  }catch{}
  for(const section of sections){
    if(typeof saved[section.id]==='boolean')section.open=saved[section.id];
    section.addEventListener('toggle',()=>{
      const state=Object.fromEntries(sections.map(item=>[item.id,item.open]));
      try{storage.setItem(SECTION_STATE_KEY,JSON.stringify(state));}catch{}
    });
  }
}

export function revealPanelSection(section){
  for(let current=section;current;current=current.parentElement){
    if(current.tagName==='DETAILS')current.open=true;
  }
}
