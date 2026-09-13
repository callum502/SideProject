import React from 'react';
const inches=Array.from({length:17},(_,i)=>i-8);
export default function ProfileFields({ user }) {
 const initial = user?.height ? Math.round(user.height / 2.54) : null;
 const [feet, setFeet] = React.useState(initial === null ? '' : String(Math.floor(initial / 12)));
 const [heightInches, setHeightInches] = React.useState(initial === null ? '' : String(initial % 12));
 const [heightChanged, setHeightChanged] = React.useState(false);
 const allowedInches = Array.from({length:12},(_,i)=>i);
 const height = feet === '' || heightInches === '' ? '' : !heightChanged && user?.height ? user.height : Math.round((Number(feet)*12+Number(heightInches))*2.54);

 return <><label>Display name *<input name="name" required maxLength={120} autoComplete="nickname" defaultValue={user?.profileComplete === false && (user?.name === 'Climber' || /^Climber-[0-9a-f-]{36}$/i.test(user?.name || '')) ? '' : user?.name || ''} placeholder="How you’d like to be known"/></label>
 <div className="form-columns"><label>Height (feet) *<select name="heightFeet" required value={feet} onChange={e=>{ const next=e.target.value; setFeet(next);setHeightChanged(true); }}><option value="" disabled hidden>Feet</option>{Array.from({length:10},(_,i)=>i+1).map(ft=><option key={ft} value={ft}>{ft} ft</option>)}</select></label><label>Height (inches) *<select name="heightInches" required value={heightInches} onChange={e=>{setHeightInches(e.target.value);setHeightChanged(true);}}><option value="" disabled hidden>Inches</option>{allowedInches.map(value=><option key={value} value={value}>{value} In</option>)}</select></label></div><input type="hidden" name="height" value={height}/>
 <label>Ape index<select name="apeIndex" defaultValue={user?.apeIndex ?? 'unknown'}><option value="unknown">Not sure</option>{inches.map(value=><option key={value} value={value}>{value>0?'+':''}{value} In</option>)}</select></label></>;
}
