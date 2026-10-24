"""Explicit local browser fixture. Never imported by the production service."""
import hashlib
import sys
import threading
import socket
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ControlService'))
from server import Server,State,Handler
from agent_portal import AgentPortal
from concept_store import ConceptStore
from test_agent_portal import FakeBackend
from test_concept_store import FakeConceptCatalog,FakeNativePortal,panorama_png

class NativeFixture(FakeNativePortal):
    def start_native_image(self,session_id,prompt):
        result=super().start_native_image(session_id,prompt)
        self.image.write_bytes(panorama_png())
        def finish():
            self.results[result['turnId']]={'status':'ready','imagePath':str(self.image),
                'sha256':hashlib.sha256(self.image.read_bytes()).hexdigest(),'mimeType':'image/png'}
        timer=threading.Timer(1.2,finish);timer.daemon=True;timer.start()
        return result

class FixtureHandler(Handler):
    def do_GET(self):
        if self.path=='/professor-fixture':
            scene=(self.server.state.latest or {}).get('scene',{})
            self.send_data(200,{'fixture':True,'nativeImageCalls':len(self.server.native.requests),
                'environment':scene.get('environment'),'pendingWorldCommands':len(self.server.state.pending)})
            return
        return super().do_GET()

if __name__=='__main__':
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1',8765)) == 0:
            raise RuntimeError('Port 8765 already has a listener; fixture will not replace it.')
    root=ROOT/'.utmp'/'professor-connection-fixture';root.mkdir(parents=True,exist_ok=True)
    state=State(root/'state',web_assets_directory=root/'assets',web_environments_directory=root/'environments')
    state.agent_portal=AgentPortal(root/'portal',lambda:FakeBackend([False]))
    catalog=FakeConceptCatalog(root/'cache');native=NativeFixture(catalog.image)
    state.concepts=ConceptStore(root/'concepts',lambda:catalog,lambda:native)
    server=Server(('127.0.0.1',8765),state);server.RequestHandlerClass=FixtureHandler
    server.professor_ui=Path(sys.argv[1]).resolve();server.professor_port=3110;server.native=native
    try:server.serve_forever()
    finally:server.server_close()
