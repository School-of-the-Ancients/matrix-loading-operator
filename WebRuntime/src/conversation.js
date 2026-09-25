export const CHAT_KEY='matrix-web-conversation-v1';
export const MAX_TURNS=6;
const MAX_TEXT=1000;

function turn(user,assistant){
  return {user:String(user||'').trim().slice(0,MAX_TEXT),assistant:String(assistant||'').trim().slice(0,MAX_TEXT)};
}

export function loadConversation(storage){
  try{
    const value=JSON.parse(storage.getItem(CHAT_KEY)||'[]');
    if(!Array.isArray(value))return [];
    return value.slice(-MAX_TURNS).filter(item=>item&&typeof item.user==='string'&&typeof item.assistant==='string')
      .map(item=>turn(item.user,item.assistant)).filter(item=>item.user&&item.assistant);
  }catch{return [];}
}

export function rememberTurn(storage,history,user,assistant){
  const next=turn(user,assistant);
  if(!next.user||!next.assistant)return history;
  const updated=[...history,next].slice(-MAX_TURNS);
  try{storage.setItem(CHAT_KEY,JSON.stringify(updated));}catch{/* Conversation still works until the tab closes. */}
  return updated;
}

export function clearConversation(storage){
  try{storage.removeItem(CHAT_KEY);}catch{/* In-memory reset still works. */}
  return [];
}
