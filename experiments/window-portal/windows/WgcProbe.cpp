#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <atomic>
#include <iostream>
#include <algorithm>
using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
int main(int argc,char** argv){
  if(argc!=2)return 2;
  try{
    init_apartment(apartment_type::multi_threaded);
    HWND hwnd=reinterpret_cast<HWND>(std::stoull(argv[1]));
    auto interop=get_activation_factory<GraphicsCaptureItem,IGraphicsCaptureItemInterop>();
    GraphicsCaptureItem item{nullptr};
    check_hresult(interop->CreateForWindow(hwnd,guid_of<GraphicsCaptureItem>(),put_abi(item)));
    com_ptr<ID3D11Device> device;com_ptr<ID3D11DeviceContext> context;
    check_hresult(D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,device.put(),nullptr,context.put()));
    com_ptr<IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(device.as<IDXGIDevice>().get(),inspectable.put()));
    auto runtime=inspectable.as<IDirect3DDevice>();
    auto pool=Direct3D11CaptureFramePool::CreateFreeThreaded(runtime,DirectXPixelFormat::B8G8R8A8UIntNormalized,2,item.Size());
    auto session=pool.CreateCaptureSession(item);
    std::atomic<unsigned> frames{0},hash{0};
    std::atomic<bool> failed{false};
    auto token=pool.FrameArrived([&](auto const& sender,auto const&){
      try{
        auto frame=sender.TryGetNextFrame();if(!frame)return;
        auto access=frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        com_ptr<ID3D11Texture2D> texture;
        check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D),texture.put_void()));
        D3D11_TEXTURE2D_DESC desc{};texture->GetDesc(&desc);
        desc.Usage=D3D11_USAGE_STAGING;desc.BindFlags=0;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;desc.MiscFlags=0;
        com_ptr<ID3D11Texture2D> stage;check_hresult(device->CreateTexture2D(&desc,nullptr,stage.put()));
        context->CopyResource(stage.get(),texture.get());D3D11_MAPPED_SUBRESOURCE mapped{};
        check_hresult(context->Map(stage.get(),0,D3D11_MAP_READ,0,&mapped));
        unsigned h=2166136261u;
        for(unsigned y=0;y<desc.Height;y+=std::max(1u,desc.Height/50)){
          auto row=reinterpret_cast<unsigned char*>(mapped.pData)+y*mapped.RowPitch;
          for(unsigned x=0;x<desc.Width;x+=std::max(1u,desc.Width/80))for(int c=0;c<3;c++)h=(h^row[x*4+c])*16777619u;
        }
        context->Unmap(stage.get(),0);hash=h;frames++;
      }catch(...){failed=true;}
    });
    session.StartCapture();
    for(int i=0;i<80 && IsWindow(hwnd);i++){Sleep(500);std::cout<<"{\"frames\":"<<frames<<",\"hash\":"<<hash<<",\"failed\":"<<(failed?"true":"false")<<"}"<<std::endl;}
    pool.FrameArrived(token);session.Close();pool.Close();
    return failed?1:0;
  }catch(hresult_error const& e){std::cerr<<"WGC error 0x"<<std::hex<<e.code().value<<" "<<to_string(e.message())<<std::endl;return 1;}
}
