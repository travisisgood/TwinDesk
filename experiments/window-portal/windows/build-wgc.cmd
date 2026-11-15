@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
cl /nologo /std:c++17 /EHsc /O2 /DWIN32_LEAN_AND_MEAN /DNOMINMAX WgcProbe.cpp /Fe:WindowPortal.WgcProbe.exe /link d3d11.lib windowsapp.lib runtimeobject.lib user32.lib
