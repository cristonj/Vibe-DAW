import '../../src/main';
import { showReviewFixture } from './uiFixture';
import { useAgent } from '../../src/agent/agent';
showReviewFixture();
document.querySelector<HTMLButtonElement>('#working-fixture')!.onclick = () => useAgent.setState({ running: true, abort: new AbortController(), status: 'Checking the arrangement…' });
document.querySelector<HTMLButtonElement>('#clear-fixture')!.onclick = () => useAgent.getState().clear();
