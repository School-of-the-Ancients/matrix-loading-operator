import unittest
from types import SimpleNamespace
from connect_professor_quest import connect

class QuestLinkTests(unittest.TestCase):
    def runner(self, devices='quest1 device product:eureka model:Quest_3', mapping=''):
        calls=[]
        def run(args, **kwargs):
            nonlocal mapping
            calls.append(args)
            if args[1:]==['devices','-l']: value='List of devices attached\n'+devices
            elif args[-2:]==['getprop','ro.product.model']: value='Quest 3'
            elif args[-2:]==['reverse','--list']: value=mapping
            elif args[-3:]==['reverse','tcp:8765','tcp:8765']: mapping='UsbFfs tcp:8765 tcp:8765'; value=''
            else: value=''
            return SimpleNamespace(returncode=0,stdout=value)
        return run,calls
    def test_maps_only_the_professor_port(self):
        run,calls=self.runner(mapping='UsbFfs tcp:5173 tcp:5173')
        self.assertEqual(connect('adb',run)['transport'],'USB')
        self.assertEqual([call[-3:] for call in calls if call[-3:-2]==['reverse']],[['reverse','tcp:8765','tcp:8765']])
    def test_existing_different_target_is_never_overwritten(self):
        run,calls=self.runner(mapping='UsbFfs tcp:8765 tcp:8000')
        with self.assertRaisesRegex(RuntimeError,'left unchanged'):connect('adb',run)
        self.assertFalse(any(call[-1]=='tcp:8765' for call in calls))
    def test_ambiguous_and_wireless_devices_are_rejected(self):
        for devices in ['quest1 device\nquest2 device','192.168.1.4:5555 device']:
            run,_=self.runner(devices)
            with self.assertRaisesRegex(RuntimeError,'exactly one'):connect('adb',run)
