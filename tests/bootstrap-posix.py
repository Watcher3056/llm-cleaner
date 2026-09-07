import os,pathlib,tempfile,subprocess,pty,select,time,hashlib
repo=str(pathlib.Path(__file__).resolve().parent.parent)
root=pathlib.Path(tempfile.mkdtemp(prefix='llm-node-bootstrap-'))
# An isolated PATH models a machine without Node.js, even if /usr/bin/node exists.
bin_dir=root/'bin';bin_dir.mkdir()
import shutil
for name in ['sh','dirname','uname','mkdir','mktemp','curl','wget','awk','sha256sum','shasum','tar','gzip','mv','rm']:
    found=shutil.which(name)
    if found:(bin_dir/name).symlink_to(found)
env={**os.environ,'PATH':str(bin_dir),'XDG_DATA_HOME':str(root/'data'),'HOME':str(root)}
args=['/bin/sh',repo+'/run-cleaner.sh','--help']
r=subprocess.run(args,env=env,input='',text=True,capture_output=True);assert r.returncode!=0 and 'Run interactively' in r.stderr;assert not (root/'data').exists()
def interactive(answer):
 master,slave=pty.openpty();p=subprocess.Popen(args,env=env,stdin=slave,stdout=slave,stderr=slave);os.close(slave);out='';sent=False;limit=time.monotonic()+120
 try:
  while time.monotonic()<limit:
   if select.select([master],[],[],.2)[0]:
    try:data=os.read(master,65536)
    except OSError:break
    out+=data.decode(errors='replace')
    if '[y/N]' in out and not sent:os.write(master,answer.encode()+b'\n');sent=True
   if p.poll() is not None:break
  else:raise Exception('Timeout')
  code=p.wait(timeout=5);return code,out
 finally:
  os.close(master)
  if p.poll() is None:p.kill()
code,out=interactive('');assert code!=0 and 'cancelled' in out;assert not (root/'data').exists()
code,out=interactive('yes');(root/'install.log').write_text(out);assert code==0,out;assert 'node src/chat-storage.cjs' in out
r=subprocess.run(args,env=env,input='',text=True,capture_output=True);assert r.returncode==0 and 'Download' not in r.stdout
print('PASS: no unattended install, Enter declines, approved official download and launch, cached runtime reuse',root)
