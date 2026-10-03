import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";
import { errorInterceptor } from "./app/error.interceptor";

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(withInterceptors([errorInterceptor]))]
}).catch((error: unknown) => console.error(error));
