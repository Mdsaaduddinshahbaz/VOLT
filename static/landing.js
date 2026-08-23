function selectRole(role) {
      if (role === 'user') {
        console.log("role")
        const userid=localStorage.getItem("userId")
        if (userid){
          window.location.href=`/user/${userid}`
        }
        else{
        window.location.href = "/login/user";  
        } // change route
      } else if(role=== 'driver') {
        // const res_id=localStorage.getItem("res_id")
        window.location.href=`/driver`
        // if (res_id){
        //   window.location.href=`/seller//${res_id}`
        // }
        // else{
        //   window.location.href = "/login/seller";  
        // } // change route
        // window.location.href = "/seller"; // change route
      }
      else{
        window.location.href=`/login/seller`
      }
    }
    