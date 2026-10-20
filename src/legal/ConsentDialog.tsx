import { useEffect, useRef, useState } from 'react';
import { finishLegalAcceptance, useLegalConsent } from './acceptance';
import './legal.css';
import {isNativeApp,hasNativeCapability} from '../native/native-bridge';

function ConsentForm() {
  const ref = useRef<HTMLDialogElement>(null);
  const [adult, setAdult] = useState(false);
  const [agreed, setAgreed] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="legal-consent" aria-labelledby="legal-consent-title" onCancel={() => finishLegalAcceptance(false)}>
    <h2 id="legal-consent-title">Before you sign in</h2>
    <p>Your sign-in provider shares your profile and email. Your projects, audio library, settings, and Gemini key sync to your private account.</p>
    <label><input type="checkbox" checked={adult} onChange={event => setAdult(event.target.checked)} />I am 18 or older.</label>
    <label><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>I agree to the <a href="/terms/" target="_blank" rel="noopener noreferrer">Terms of Service</a> and acknowledge the <a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>
    <div><button className="btn" onClick={() => finishLegalAcceptance(false)}>Cancel</button>
      <button className="btn primary" disabled={!adult || !agreed} onClick={() => {useLegalConsent.setState({provider:'apple'});finishLegalAcceptance(true);}}><span aria-hidden></span> Continue with Apple</button>
      {(!isNativeApp() || hasNativeCapability('googleAuth')) && <button className="btn primary" disabled={!adult || !agreed} onClick={() => {useLegalConsent.setState({provider:'google'});finishLegalAcceptance(true);}}>Continue with Google</button>}
    </div>
  </dialog>;
}
export function ConsentDialog() {
  const open = useLegalConsent(state => state.open);
  return open ? <ConsentForm /> : null;
}
